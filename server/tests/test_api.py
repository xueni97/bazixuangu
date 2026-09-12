"""八字选股后端测试。

运行:
  cd bazi-stock-app
  ..\\.venv\\Scripts\\python.exe -m pytest server/tests -v
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

import data_sync  # noqa: E402


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    """临时数据库，替换 data_sync.DB_PATH 与 app.DB_PATH。"""
    db = tmp_path / "test.db"
    monkeypatch.setattr(data_sync, "DB_PATH", db)
    conn = sqlite3.connect(str(db))
    conn.executescript(
        """
        CREATE TABLE stock_names (symbol TEXT PRIMARY KEY, name TEXT, industry TEXT);
        CREATE TABLE stock_spot (symbol TEXT PRIMARY KEY, name TEXT, price REAL,
            change_pct REAL, market TEXT, updated_at TEXT);
        CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT);
        """
    )
    conn.executemany(
        "INSERT INTO stock_names VALUES (?, ?, '')",
        [("600519", "贵州茅台"), ("000001", "平安银行"), ("300750", "宁德时代"),
         ("688981", "中芯国际"), ("832000", "测试北交")],
    )
    conn.commit()
    conn.close()
    yield db


@pytest.fixture()
def client(temp_db, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "DB_PATH", temp_db)
    app_module._sectors_cache.update(date="", source="", data={})
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


# ── data_sync 单元 ──────────────────────────────────────────


def test_classify_market():
    assert data_sync.classify_market("600519") == "沪"
    assert data_sync.classify_market("688981") == "沪"
    assert data_sync.classify_market("000001") == "深"
    assert data_sync.classify_market("300750") == "深"
    assert data_sync.classify_market("832000") == "北交所"


def test_parse_eastmoney_payload():
    """东财 delay JSON 解析：跳过空代码，'-' 价格 → None。"""
    payload = {
        "data": {
            "total": 2,
            "diff": [
                {"f12": "600519", "f13": 1, "f14": "贵州茅台", "f2": 1500.0, "f3": 2.5},
                {"f12": "000001", "f13": 0, "f14": "平安银行", "f2": "-", "f3": "-"},
            ],
        }
    }
    rows = data_sync._parse_em_payload(payload)
    assert rows[0] == ("600519", "贵州茅台", 1500.0, 2.5, "沪", rows[0][5])
    assert rows[1][2] is None and rows[1][3] is None


def test_parse_tencent_text():
    """腾讯批量响应解析：bj 前缀归属北交所，市场字段正确。"""
    text = (
        'v_sh600519="1~贵州茅台~600519~1275.16~1285.13~1285.15~a~b~c~d~e~f~g~h~i~j~k~l~m~n~o~'
        "p~q~r~s~t~u~v~w~x~y~z~aa~20260912160000~0.55~2.51~1290.00~1270.00"
        '~9.80~44308~4430841~1.10~20.5~0~0~0~0~0~0~0~0~0~0";'
        'v_bj833533="1~骏创科技~833533~12.86~12.86~12.86~a~b~c~d~e~f~g~h~i~j~k~l~m~n~o~'
        "p~q~r~s~t~u~v~w~x~y~z~aa~20260912160000~0.00~0.00~13.00~12.50"
        '~9.80~443~4430~1.10~20.5~0~0~0~0~0~0~0~0~0~0";'
    )
    rows = data_sync._parse_tencent_text(text)
    assert len(rows) == 2
    assert rows[0][0] == "600519" and rows[0][4] == "沪"
    assert rows[0][2] == 1275.16
    assert rows[1][0] == "833533" and rows[1][4] == "北交所"


def test_parse_sina_list():
    """新浪列表解析：bj920 段归属北交所。"""
    items = [
        {"symbol": "bj920000", "name": "安徽凤凰", "trade": "13.550", "changepercent": "-2.448"},
        {"symbol": "sz000001", "name": "平安银行", "trade": "12.00", "changepercent": "1.0"},
        {"symbol": "bad", "name": "坏行", "trade": "1", "changepercent": "0"},
    ]
    rows = data_sync._parse_sina_list(items)
    assert len(rows) == 2
    assert rows[0][0] == "920000" and rows[0][4] == "北交所"
    assert rows[1][2] == 12.0


def test_fetch_chain_fallback(temp_db, monkeypatch):
    """东财与腾讯都失败时，自动切到新浪源成功。"""
    def em_fail():
        raise RuntimeError("em down")

    def tx_fail():
        raise RuntimeError("tx down")

    sina_rows = [("600519", "贵州茅台", 10.0, 1.0, "沪", "t")]
    monkeypatch.setattr(data_sync, "_fetch_eastmoney", em_fail)
    monkeypatch.setattr(data_sync, "_fetch_tencent", tx_fail)
    monkeypatch.setattr(data_sync, "_fetch_sina", lambda: sina_rows)
    monkeypatch.setattr(data_sync.time, "sleep", lambda s: None)

    rows, source = data_sync._fetch_snapshot()
    assert source == "sina"
    assert rows == sina_rows


def test_sync_state_machine(temp_db, monkeypatch):
    """成功路径: idle → syncing → idle，且记录 last_success 与来源。"""
    good_rows = [("600519", "贵州茅台", 10.0, 1.0, "沪", "2026-09-12 10:00:00")]
    monkeypatch.setattr(
        data_sync, "_fetch_snapshot", lambda: (good_rows, "eastmoney")
    )

    result = data_sync.sync_spot()
    assert result["ok"] is True
    assert "eastmoney" in result["message"]
    assert data_sync.get_state()["status"] == "idle"
    assert data_sync.get_last_success() is not None
    assert data_sync.get_spot_count() == 1


def test_sync_failure_keeps_state(temp_db, monkeypatch):
    """所有数据源持续失败: 状态 failed，不写库。"""
    def boom():
        raise RuntimeError("网络超时")

    monkeypatch.setattr(data_sync, "_fetch_snapshot", boom)
    monkeypatch.setattr(data_sync.time, "sleep", lambda s: None)

    result = data_sync.sync_spot()
    assert result["ok"] is False
    st = data_sync.get_state()
    assert st["status"] == "failed"
    assert "网络超时" in st["last_error"]
    assert data_sync.get_spot_count() == 0
    assert data_sync.get_last_success() is None


def test_sync_idempotent_when_syncing(temp_db, monkeypatch):
    """同步进行中再次触发 → 拒绝。"""
    import threading

    release = threading.Event()

    def slow_fetch():
        release.wait(timeout=5)
        return []

    monkeypatch.setattr(data_sync, "_fetch_snapshot", slow_fetch)
    t = threading.Thread(target=data_sync.sync_spot, daemon=True)
    t.start()
    try:
        import time
        time.sleep(0.2)  # 等线程进入 syncing
        result = data_sync.sync_spot()
        assert result["ok"] is False
        assert "进行中" in result["message"]
    finally:
        release.set()
        t.join(timeout=5)


# ── API 契约 ────────────────────────────────────────────────


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "ok"


def test_scan_fallback_to_names(client):
    """无快照时降级 stock_names，dataSource=names，price 为 null。"""
    resp = client.get("/api/scan?min_score=-100&limit=10")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["dataSource"] == "names"
    assert body["totalScanned"] == 5
    assert all(r["price"] is None for r in body["results"])
    # JSON 输出为 camelCase
    for key in ("dayMaster", "useGods", "avoidGods", "totalScanned"):
        assert key in body


def test_scan_with_spot(client, temp_db):
    """有快照时使用全市场 universe，结果带价格。"""
    conn = sqlite3.connect(str(temp_db))
    conn.executemany(
        "INSERT INTO stock_spot VALUES (?, ?, ?, ?, ?, ?)",
        [("600519", "贵州茅台", 1500.0, 2.5, "沪", "2026-09-12"),
         ("000001", "平安银行", 12.0, -1.0, "深", "2026-09-12")],
    )
    conn.commit()
    conn.close()

    resp = client.get("/api/scan?min_score=-100&limit=10")
    body = resp.get_json()
    assert body["dataSource"] == "spot"
    assert body["totalScanned"] == 2
    by_symbol = {r["symbol"]: r for r in body["results"]}
    assert by_symbol["600519"]["price"] == 1500.0
    assert by_symbol["600519"]["changePct"] == 2.5


def test_search(client, temp_db):
    resp = client.get("/api/search?q=茅台")
    body = resp.get_json()
    assert resp.status_code == 200
    assert body[0]["symbol"] == "600519"
    assert body[0]["price"] is None  # 无快照降级

    conn = sqlite3.connect(str(temp_db))
    conn.execute("INSERT INTO stock_spot VALUES ('600519','贵州茅台',1500.0,2.5,'沪','2026-09-12')")
    conn.commit()
    conn.close()
    body = client.get("/api/search?q=600519").get_json()
    assert body[0]["price"] == 1500.0


def test_sectors_counts_all(client):
    resp = client.get("/api/sectors")
    assert resp.status_code == 200
    body = resp.get_json()
    assert set(body.keys()) == {"木", "火", "土", "金", "水", "未知"}
    assert sum(body.values()) == 5  # 全 universe 计数


def test_sync_endpoints(client, monkeypatch):
    monkeypatch.setattr("data_sync.sync_spot_async", lambda: {"ok": True, "message": "已启动后台同步"})
    resp = client.post("/api/sync")
    assert resp.status_code == 200

    resp = client.get("/api/sync/status")
    body = resp.get_json()
    assert "status" in body and "last_success_date" in body


def test_index_spa_fallback(client):
    """根路径与未知路径返回 index.html（hash 路由 SPA）。"""
    dist = Path(app_static_dir())
    index_file = dist / "index.html"
    if not index_file.exists():
        pytest.skip("dist 未构建")
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"app" in resp.data


def app_static_dir() -> str:
    import app as app_module

    return app_module.app.static_folder
