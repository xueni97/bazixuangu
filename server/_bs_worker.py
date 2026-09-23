"""baostock 抓取子进程（进程级隔离，根治 socket 阻塞卡死）。

baostock 库底层是裸 TCP，query 阻塞在 socket recv 时**无法在 Python
线程层被打断**（future 超时 / shutdown(wait=False) 都杀不掉运行中的线程，
其持有的全局锁会永久卡死主进程后续所有任务）。

因此由 data_sync.sync_ma 以 subprocess 方式启动本脚本，一批票一个子进程：
- stdin：一行 JSON  {"symbols": ["600519", "000001", ...]}
- stdout：每只票一行 JSON（逐行 flush，父进程按行解析）
    成功 {"symbol": "600519", "ok": true, "rows": [["YYYY-MM-DD", 收盘价], ...]}
    失败 {"symbol": "600519", "ok": false}
- 子进程整体超时由父进程 subprocess.run(timeout=) 控制，超时直接杀进程，
  主流程继续下一批，已落库的数据不丢。
"""

from __future__ import annotations

import contextlib
import json
import sys
from datetime import datetime, timedelta

import baostock as bs

# 一次拉全部历史（前复权），自然日保险取 3 倍
KLINE_LMT = 432


def bs_code(symbol: str) -> str | None:
    """沪深代码转 baostock 格式；北交所等不支持返 None。"""
    if symbol.startswith(("60", "68", "90")):
        return "sh." + symbol
    if symbol.startswith(("00", "20", "30")):
        return "sz." + symbol
    return None


def _emit(msg: dict) -> None:
    """输出一行结果并立即 flush（nohup/管道重定向时父进程才能实时读到）。"""
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def main() -> int:
    line = sys.stdin.readline()
    if not line:
        return 1
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        return 1
    symbols = req.get("symbols", [])
    if not symbols:
        return 0

    # baostock login 会自行 print "login success!"，重定向到 stderr，
    # 保持 stdout 只有 JSON 行（父进程按行解析）
    with contextlib.redirect_stdout(sys.stderr):
        lg = bs.login()
    if lg.error_code != "0":
        # login 失败：整批票输出失败，父进程下一批会重新起进程再试
        for sym in symbols:
            _emit({"symbol": sym, "ok": False})
        return 0

    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=KLINE_LMT * 3)).strftime("%Y-%m-%d")

    try:
        for sym in symbols:
            code = bs_code(sym)
            if not code:
                _emit({"symbol": sym, "ok": False})
                continue
            try:
                rs = bs.query_history_k_data_plus(
                    code, "date,close",
                    start_date=start, end_date=end,
                    frequency="d", adjustflag="2",  # 2=前复权
                )
                if rs.error_code != "0":
                    _emit({"symbol": sym, "ok": False})
                    continue
                rows = []
                while rs.next():
                    r = rs.get_row_data()
                    if len(r) >= 2 and r[0] and r[1]:
                        try:
                            rows.append([r[0], float(r[1])])
                        except ValueError:
                            pass
                _emit({"symbol": sym, "ok": bool(rows), "rows": rows})
            except Exception:  # noqa: BLE001 - 单只失败不影响同批其他票
                _emit({"symbol": sym, "ok": False})
    finally:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                bs.logout()
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
