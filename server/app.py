"""渊海子平命理选股 Flask 后端 API。

提供股票名称查询和本地股票库扫描接口。
核心命理计算在前端JS完成，后端只负责数据查询。

运行方式:
  cd c:\SVN\Seq\Sequoia-X
  .venv\Scripts\python.exe bazi-stock-app\server\app.py
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

from flask import Flask, jsonify, request

# 将 sequoia_x 包路径加入 sys.path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from sequoia_x.strategy.metaphysics import (
    BaziEngine,
    StockElementAnalyzer,
    YuanhaiDecisionModel,
)
from datetime import datetime

app = Flask(__name__)

@app.after_request
def after_request(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

DB_PATH = PROJECT_ROOT / "data" / "sequoia_v2.db"


def _get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_stock_names(conn):
    """确保 stock_names 表存在并填充。"""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stock_names ("
        "symbol TEXT PRIMARY KEY, name TEXT, industry TEXT)"
    )
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM stock_names").fetchone()[0]
    if count > 0:
        return True

    # 通过 baostock 获取
    try:
        import baostock as bs
        bs.login()
        rows = []
        rs = bs.query_stock_basic(code_name="", code="")
        while rs.next():
            row = rs.get_row_data()
            code = row[0].split(".")[1]
            name = row[1]
            rows.append((code, name, ""))
        bs.logout()

        conn.executemany(
            "INSERT OR REPLACE INTO stock_names (symbol, name, industry) VALUES (?, ?, ?)",
            rows,
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"获取股票名称失败: {e}")
        return False


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "db_exists": DB_PATH.exists()})


@app.route("/api/stock-names", methods=["GET"])
def stock_names():
    """获取股票名称列表。"""
    if not DB_PATH.exists():
        return jsonify({"error": "数据库不存在，请先运行 --backfill"}), 404

    conn = _get_db()
    _ensure_stock_names(conn)
    rows = conn.execute(
        "SELECT symbol, name FROM stock_names ORDER BY symbol"
    ).fetchall()
    conn.close()
    return jsonify([{"symbol": r[0], "name": r[1]} for r in rows])


@app.route("/api/search", methods=["GET"])
def search():
    """搜索股票（按代码或名称）。"""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])

    if not DB_PATH.exists():
        return jsonify({"error": "数据库不存在"}), 404

    conn = _get_db()
    _ensure_stock_names(conn)
    rows = conn.execute(
        "SELECT symbol, name FROM stock_names "
        "WHERE symbol LIKE ? OR name LIKE ? LIMIT 20",
        (f"%{q}%", f"%{q}%"),
    ).fetchall()
    conn.close()
    return jsonify([{"symbol": r[0], "name": r[1]} for r in rows])


@app.route("/api/scan", methods=["GET"])
def scan():
    """
    扫描本地股票库，按用神评分排序。

    参数:
      year, month, day, hour: 指定时间（默认当前时间）
      min_score: 最低分数（默认10）
      limit: 返回数量（默认100）
    """
    if not DB_PATH.exists():
        return jsonify({"error": "数据库不存在，请先运行 --backfill"}), 404

    # 解析时间参数
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

    conn = _get_db()
    _ensure_stock_names(conn)
    rows = conn.execute(
        "SELECT s.symbol, n.name FROM stock_daily s "
        "LEFT JOIN stock_names n ON s.symbol = n.symbol "
        "GROUP BY s.symbol ORDER BY s.symbol"
    ).fetchall()
    conn.close()

    results = []
    for row in rows:
        symbol = row[0]
        name = row[1] or symbol
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
        "totalScanned": len(rows),
        "totalMatched": len(results),
        "results": results,
    })


if __name__ == "__main__":
    print(f"数据库路径: {DB_PATH}")
    print(f"数据库存在: {DB_PATH.exists()}")
    app.run(host="127.0.0.1", port=5175, debug=True)
