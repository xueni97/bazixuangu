"""全市场股票快照同步模块（多数据源 fallback 链）。

背景：东财 push2 主域在部分网络下连接被重置（RemoteDisconnected），导致
akshare stock_zh_a_spot_em 长期拉取失败。经实测验证的可用源链：

1. eastmoney-delay  push2delay.eastmoney.com（东财延时域，全市场含北交所，~10 次分页请求，最快）
2. tencent          qt.gtimg.cn 批量行情（按 stock_names 代码表批量拉，含北交所 bj 前缀）
3. sina             vip.stock.finance.sina.com.cn 列表接口（沪深A+北交所 920 段，80 条/页）

状态机 idle → syncing → done/failed，线程安全（后台线程同步，不阻塞 API）。
stock_spot 表每次同步整表替换，sync_meta 记录最近成功日期与使用的数据源。
"""

from __future__ import annotations

import json
import math
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = PROJECT_ROOT / "data" / "sequoia_v2.db"

MAX_RETRIES_PER_SOURCE = 2
RETRY_INTERVAL = 3  # 秒
REQUEST_TIMEOUT = 15  # 秒
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

_lock = threading.Lock()
_state = {
    "status": "idle",       # idle / syncing / failed
    "phase": "",            # 阶段描述
    "last_error": "",
    "started_at": "",
    "finished_at": "",
}


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stock_spot ("
        "symbol TEXT PRIMARY KEY, name TEXT, price REAL, "
        "change_pct REAL, market TEXT, updated_at TEXT)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_meta ("
        "key TEXT PRIMARY KEY, value TEXT)"
    )
    conn.commit()


def get_state() -> dict:
    """当前同步状态（供 API 查询）。"""
    with _lock:
        st = dict(_state)
    last = get_last_success()
    st["last_success_date"] = last
    st["today_synced"] = (last == datetime.now().strftime("%Y-%m-%d"))
    return st


def get_last_success() -> str | None:
    if not DB_PATH.exists():
        return None
    conn = get_conn()
    try:
        ensure_tables(conn)
        row = conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'last_success_date'"
        ).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def get_spot_count() -> int:
    if not DB_PATH.exists():
        return 0
    conn = get_conn()
    try:
        ensure_tables(conn)
        return conn.execute("SELECT COUNT(*) FROM stock_spot").fetchone()[0]
    finally:
        conn.close()


def classify_market(symbol: str) -> str:
    """按代码前缀划分市场。"""
    if symbol.startswith(("60", "68")):
        return "沪"
    if symbol.startswith(("00", "30")):
        return "深"
    return "北交所"


def _to_num(v):
    """行情值规范化：'-'、NaN、0、None → None。"""
    if v is None or v == "" or v == "-":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or f == 0:
        return None
    return f


# ── 数据源 1：东财 push2delay（分页 JSON，全市场含北交所） ──────────

_EM_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"
_EM_PAGE_SIZE = 100  # push2delay 域单页上限 100 条


def _parse_em_payload(payload: dict) -> list[tuple]:
    """解析东财 clist JSON → 规范化行。纯函数，便于测试。"""
    data = (payload or {}).get("data") or {}
    diffs = data.get("diff") or []
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    for d in diffs:
        symbol = str(d.get("f12", "")).strip()
        if not symbol:
            continue
        name = str(d.get("f14", "") or "").strip()
        rows.append((
            symbol, name,
            _to_num(d.get("f2")),
            _to_num(d.get("f3")),
            classify_market(symbol), now,
        ))
    return rows


def _fetch_eastmoney() -> list[tuple]:
    """东财延时域全市场快照。"""
    session = requests.Session()
    session.headers.update(_UA)
    all_rows: dict[str, tuple] = {}
    page = 1
    while True:
        url = (
            "https://push2delay.eastmoney.com/api/qt/clist/get?"
            f"pn={page}&pz={_EM_PAGE_SIZE}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281"
            f"&fltt=2&invt=2&fid=f12&fs={_EM_FS}&fields=f12,f13,f14,f2,f3"
        )
        r = session.get(url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        payload = r.json()
        rows = _parse_em_payload(payload)
        if not rows:
            break
        for row in rows:
            all_rows[row[0]] = row
        total = ((payload or {}).get("data") or {}).get("total") or 0
        if page * _EM_PAGE_SIZE >= total or len(rows) < _EM_PAGE_SIZE:
            break
        page += 1
        time.sleep(0.2)
    return list(all_rows.values())


# ── 数据源 2：腾讯批量行情（按本地代码表，含北交所 bj 前缀） ────────


def _parse_tencent_text(text: str) -> list[tuple]:
    """解析腾讯 qt.gtimg.cn 批量响应。纯函数，便于测试。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    for line in text.strip().split(";"):
        line = line.strip()
        if not line or "=" not in line:
            continue
        parts = line.split("=", 1)[1].strip().strip('"').split("~")
        if len(parts) < 33:
            continue
        code_field = parts[2].strip()
        symbol = code_field.lower().replace("sh", "").replace("sz", "").replace("bj", "") \
            if not code_field[:1].isdigit() else code_field
        if len(symbol) != 6 or not symbol.isdigit():
            symbol = parts[2][-6:] if parts[2][-6:].isdigit() else ""
        if not symbol:
            continue
        name = parts[1].strip()
        rows.append((
            symbol, name,
            _to_num(parts[3]),
            _to_num(parts[32]),
            classify_market(symbol), now,
        ))
    return rows


def _fetch_tencent(conn: sqlite3.Connection) -> list[tuple]:
    """按 stock_names 全表代码，腾讯批量行情拉取。"""
    names = conn.execute("SELECT symbol FROM stock_names ORDER BY symbol").fetchall()
    symbols = [r[0] for r in names]
    if not symbols:
        raise RuntimeError("stock_names 为空，腾讯源不可用")

    session = requests.Session()
    session.headers.update(_UA)
    rows = []
    batch = 80
    for i in range(0, len(symbols), batch):
        codes = ",".join(
            ("sh" if s.startswith(("6",)) else "bj" if s.startswith(("4", "8", "92")) else "sz") + s
            for s in symbols[i:i + batch]
        )
        r = session.get(f"https://qt.gtimg.cn/q={codes}", timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        r.encoding = "gbk"
        rows.extend(_parse_tencent_text(r.text))
        time.sleep(0.1)
    if not rows:
        raise RuntimeError("腾讯源返回空数据")
    return rows


# ── 数据源 3：新浪列表接口（沪深A + 北交所920段） ──────────────────


def _parse_sina_list(items: list) -> list[tuple]:
    """解析新浪 Market_Center.getHQNodeData 列表。纯函数，便于测试。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    for d in items:
        raw = str(d.get("symbol", "")).strip()  # 如 sh600519 / bj920000
        symbol = raw[-6:]
        if len(symbol) != 6 or not symbol.isdigit():
            continue
        rows.append((
            symbol,
            str(d.get("name", "") or "").strip(),
            _to_num(d.get("trade")),
            _to_num(d.get("changepercent")),
            classify_market(symbol), now,
        ))
    return rows


def _fetch_sina() -> list[tuple]:
    """新浪 hs_a 节点分页列表。"""
    session = requests.Session()
    session.headers.update({**_UA, "Referer": "https://finance.sina.com.cn"})
    all_rows: dict[str, tuple] = {}
    page, num = 1, 80
    while True:
        url = (
            "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            "Market_Center.getHQNodeData?"
            f"page={page}&num={num}&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page"
        )
        r = session.get(url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        items = json.loads(r.text)
        rows = _parse_sina_list(items)
        if not rows:
            break
        for row in rows:
            all_rows[row[0]] = row
        if len(items) < num:
            break
        page += 1
        time.sleep(0.2)
    if not all_rows:
        raise RuntimeError("新浪源返回空数据")
    return list(all_rows.values())


# ── 同步状态机 ──────────────────────────────────────────────


def _write_rows(rows: list[tuple], source: str) -> None:
    conn = get_conn()
    try:
        ensure_tables(conn)
        with conn:
            conn.execute("DELETE FROM stock_spot")
            conn.executemany(
                "INSERT OR REPLACE INTO stock_spot "
                "(symbol, name, price, change_pct, market, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )
            conn.execute(
                "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_success_date', ?)",
                (datetime.now().strftime("%Y-%m-%d"),),
            )
            conn.execute(
                "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_source', ?)",
                (source,),
            )
    finally:
        conn.close()


def _fetch_snapshot() -> tuple[list[tuple], str]:
    """多源 fallback 链：东财delay → 腾讯 → 新浪。

    返回 (rows, source_name)。全部失败抛出最后异常。
    """
    conn = get_conn()
    try:
        ensure_tables(conn)
        sources = [
            ("eastmoney", lambda: _fetch_eastmoney()),
            ("tencent", lambda: _fetch_tencent(conn)),
            ("sina", _fetch_sina),
        ]
    finally:
        conn.close()

    last_err = None
    for source_name, fetch in sources:
        for attempt in range(MAX_RETRIES_PER_SOURCE + 1):
            try:
                rows = fetch()
                if rows:
                    return rows, source_name
                last_err = RuntimeError(f"{source_name} 源返回空数据")
            except Exception as e:  # noqa: BLE001 - 网络源需逐个兜底
                last_err = e
            if attempt < MAX_RETRIES_PER_SOURCE:
                time.sleep(RETRY_INTERVAL)
        with _lock:
            _state["phase"] = f"{source_name} 源不可用，切换下一源"
    raise last_err or RuntimeError("所有数据源均失败")


def sync_spot() -> dict:
    """同步全市场快照（幂等：进行中直接返回）。"""
    with _lock:
        if _state["status"] == "syncing":
            return {"ok": False, "message": "同步进行中"}
        _state.update(status="syncing", phase="拉取中", last_error="",
                      started_at=datetime.now().strftime("%H:%M:%S"), finished_at="")

    try:
        rows, source = _fetch_snapshot()

        with _lock:
            _state["phase"] = f"写库中({len(rows)}只)"
        _write_rows(rows, source)
        with _lock:
            _state.update(status="idle", phase="", finished_at=datetime.now().strftime("%H:%M:%S"))
        return {"ok": True, "message": f"同步成功({source})，共{len(rows)}只"}

    except Exception as e:  # noqa: BLE001
        with _lock:
            _state.update(status="failed", phase="", last_error=str(e),
                          finished_at=datetime.now().strftime("%H:%M:%S"))
        return {"ok": False, "message": f"同步失败：{e}"}


def sync_spot_async() -> dict:
    """后台线程触发同步（启动时自动检测 / 手动按钮共用）。"""
    st = get_state()
    if st["status"] == "syncing":
        return {"ok": False, "message": "同步进行中"}
    if st["today_synced"]:
        return {"ok": True, "message": "今日快照已是最新", "skipped": True}

    threading.Thread(target=sync_spot, daemon=True).start()
    return {"ok": True, "message": "已启动后台同步"}
