"""渊海子平命理选股 Flask 后端。

职责：
1. 数据同步：akshare 全市场快照（data_sync.py，启动自动检测 + 手动触发）
2. API：股票搜索 / 全市场命理扫描 / 同步状态 / 五行分布
3. 页面托管：serve dist/（电脑浏览器大屏入口，监听 0.0.0.0 供手机局域网联用）

运行方式:
  cd c:\\SVN\\Seq\\Sequoia-X\\bazi-stock-app
  ..\\.venv\\Scripts\\python.exe server\\app.py
"""

from __future__ import annotations

import socket
import sys
from datetime import datetime
from pathlib import Path

from flask import Blueprint, Flask, jsonify, request, send_from_directory

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from sequoia_x.strategy.metaphysics import (  # noqa: E402
    BaziEngine,
    StockElementAnalyzer,
    YuanhaiDecisionModel,
)

from data_sync import (  # noqa: E402
    DB_PATH,
    ensure_tables,
    get_conn,
    get_spot_count,
    get_state,
    sync_spot,
    sync_spot_async,
)

app = Flask(__name__, static_folder=str(Path(__file__).parent.parent / "dist"), static_url_path="")

# ── CORS（手机浏览器调试 / 局域网联用） ──────────────────────────


@app.after_request
def after_request(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


# ── API 蓝图 ────────────────────────────────────────────────

api = Blueprint("api", __name__, url_prefix="/api")

_sectors_cache: dict = {"date": "", "source": "", "data": {}}


def _json_err(message: str, code: int):
    return jsonify({"error": message}), code


def _get_universe(conn):
    """扫描 universe：优先全市场快照（含价格），降级全量名称表。

    返回 (rows, source)，rows 元素为 (symbol, name, price, change_pct, market)。
    """
    n = get_spot_count()
    if n > 0:
        rows = conn.execute(
            "SELECT symbol, name, price, change_pct, market FROM stock_spot ORDER BY symbol"
        ).fetchall()
        source = "spot"
    else:
        rows = conn.execute(
            "SELECT symbol, name, NULL, NULL, '' FROM stock_names ORDER BY symbol"
        ).fetchall()
        source = "names"
    return rows, source


@api.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "db_exists": DB_PATH.exists(),
        "spot_count": get_spot_count(),
    })


@api.route("/stock-names")
def stock_names():
    """获取股票名称列表（全量）。"""
    if not DB_PATH.exists():
        return _json_err("数据库不存在", 404)
    conn = get_conn()
    try:
        ensure_tables(conn)
        rows = conn.execute("SELECT symbol, name FROM stock_names ORDER BY symbol").fetchall()
        return jsonify([{"symbol": r[0], "name": r[1]} for r in rows])
    finally:
        conn.close()


@api.route("/search")
def search():
    """搜索股票（按代码或名称，快照优先带价格）。"""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    if not DB_PATH.exists():
        return _json_err("数据库不存在", 404)

    conn = get_conn()
    try:
        ensure_tables(conn)
        like = f"%{q}%"
        if get_spot_count() > 0:
            rows = conn.execute(
                "SELECT symbol, name, price, change_pct FROM stock_spot "
                "WHERE symbol LIKE ? OR name LIKE ? LIMIT 20",
                (like, like),
            ).fetchall()
            return jsonify([
                {"symbol": r[0], "name": r[1], "price": r[2], "changePct": r[3]}
                for r in rows
            ])
        rows = conn.execute(
            "SELECT symbol, name FROM stock_names WHERE symbol LIKE ? OR name LIKE ? LIMIT 20",
            (like, like),
        ).fetchall()
        return jsonify([{"symbol": r[0], "name": r[1], "price": None, "changePct": None}
                        for r in rows])
    finally:
        conn.close()


@api.route("/scan")
def scan():
    """全市场命理扫描，按用神评分排序。

    参数: year/month/day/hour（默认当前）、min_score（默认10）、limit（默认100）
    """
    if not DB_PATH.exists():
        return _json_err("数据库不存在", 404)

    now = datetime.now()
    year = int(request.args.get("year", now.year))
    month = int(request.args.get("month", now.month))
    day = int(request.args.get("day", now.day))
    hour = int(request.args.get("hour", now.hour))
    min_score = int(request.args.get("min_score", 10))
    limit = int(request.args.get("limit", 100))

    dt = datetime(year, month, day, hour)
    pillars = BaziEngine.from_datetime(dt)
    analysis = YuanhaiDecisionModel.analyze(pillars)

    conn = get_conn()
    try:
        ensure_tables(conn)
        rows, source = _get_universe(conn)
    finally:
        conn.close()

    results = []
    for row in rows:
        symbol, name = row[0], row[1] or row[0]
        elem = StockElementAnalyzer.combined_element(name)
        if elem is None:
            continue
        info = YuanhaiDecisionModel.stock_score(elem, analysis, stock_name=name)
        if info["score"] >= min_score:
            results.append({
                "symbol": symbol,
                "name": name,
                "element": elem,
                "score": info["score"],
                "level": info["level"],
                "reason": info["reason"],
                "price": row[2],
                "changePct": row[3],
                "market": row[4],
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    results = results[:limit]

    return jsonify({
        "date": dt.strftime("%Y-%m-%d %H:%M"),
        "pillars": str(pillars),
        "dayMaster": analysis.day_master,
        "dayMasterElement": analysis.day_master_element,
        "dayMasterStrength": analysis.day_master_strength,
        "useGods": analysis.use_gods,
        "avoidGods": analysis.avoid_gods,
        "toneGod": analysis.tone_god,
        "dataSource": source,
        "totalScanned": len(rows),
        "totalMatched": len(results),
        "results": results,
    })


@api.route("/sectors")
def sectors():
    """全 universe 按五行分组计数（大屏分布图用，按日缓存）。"""
    if not DB_PATH.exists():
        return _json_err("数据库不存在", 404)

    today = datetime.now().strftime("%Y-%m-%d")
    if _sectors_cache["date"] == today and _sectors_cache["data"]:
        return jsonify(_sectors_cache["data"])

    conn = get_conn()
    try:
        ensure_tables(conn)
        rows, source = _get_universe(conn)
    finally:
        conn.close()

    counts = {"木": 0, "火": 0, "土": 0, "金": 0, "水": 0, "未知": 0}
    for row in rows:
        elem = StockElementAnalyzer.combined_element(row[1] or row[0])
        counts[elem if elem else "未知"] += 1

    _sectors_cache.update(date=today, source=source, data=counts)
    return jsonify(counts)


@api.route("/sync", methods=["POST"])
def trigger_sync():
    """手动触发全市场快照同步。"""
    result = sync_spot_async()
    if not result["ok"] and "进行中" in result["message"]:
        return jsonify(result), 409
    return jsonify(result)


@api.route("/sync/status")
def sync_status():
    """同步状态查询。"""
    return jsonify(get_state())


app.register_blueprint(api)


# ── 静态页面托管（电脑大屏入口） ──────────────────────────────


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.errorhandler(404)
def not_found(_e):
    # hash 路由 SPA：非 /api 路径回退到 index.html
    if request.path.startswith("/api"):
        return _json_err("接口不存在", 404)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    import threading
    import webbrowser

    if not DB_PATH.exists():
        print(f"[!] 数据库不存在: {DB_PATH}")
    else:
        print(f"[i] 数据库: {DB_PATH}")

    # 启动时自动检测：当日无快照则后台同步（不阻塞服务）
    print(f"[i] 同步检测: {sync_spot_async()['message']}")

    # 打印局域网地址（手机联用）
    try:
        hostname = socket.gethostname()
        lan_ip = socket.gethostbyname(hostname)
        print(f"[i] 电脑大屏: http://127.0.0.1:5175")
        print(f"[i] 手机联用: http://{lan_ip}:5175 （需同一WiFi，在APP设置中填入）")
    except OSError:
        pass

    # 延迟2秒自动打开浏览器（等待 Flask 起来）
    threading.Timer(2, lambda: webbrowser.open("http://127.0.0.1:5175")).start()

    app.run(host="0.0.0.0", port=5175, debug=False)
