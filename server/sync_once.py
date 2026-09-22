"""交易日数据同步单次执行入口（供 cron 调用）。

流程：
1. sync_spot() 拉全市场行情快照
2. sync_ma() 拉日 K + 算 144/288 均线 + 一并入库 stock_kline 原始 K 线

cron 配置示例（每日 16:05 收盘后触发，工作日 1-5）：
    5 16 * * 1-5 cd /opt/bazi-stock-app && .venv/bin/python server/sync_once.py >> logs/sync.log 2>&1

退出码：
    0 全部成功
    1 spot 失败
    2 ma 失败
    3 全部失败
"""

from __future__ import annotations

import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

# 加载 .env（python-dotenv 可选，无则用系统环境变量）
try:
    from dotenv import load_dotenv  # type: ignore
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:
    pass

# 让 data_sync 能 import
sys.path.insert(0, str(Path(__file__).resolve().parent))

from data_sync import get_ma_count, get_spot_count, sync_ma, sync_spot  # noqa: E402


def _log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def main() -> int:
    force = "--force" in sys.argv
    if force:
        _log("强制模式：忽略水位强制全量重拉")

    exit_code = 0
    spot_ok = False
    ma_ok = False

    # ── 1. spot 快照 ──
    try:
        _log("=== 步骤 1/2：拉取全市场行情快照 ===")
        r1 = sync_spot()
        _log(f"spot 结果：{r1.get('message', r1)}")
        spot_ok = bool(r1.get("ok"))
    except Exception as e:  # noqa: BLE001
        _log(f"spot 失败：{e}\n{traceback.format_exc()}")
        exit_code = max(exit_code, 1)

    # ── 2. ma 均线 + 原始 K 线入库 ──
    try:
        _log("=== 步骤 2/2：拉取日K + 算 MA + 入库 stock_kline ===")
        r2 = sync_ma(force=force)
        _log(f"ma 结果：{r2.get('message', r2)}")
        ma_ok = bool(r2.get("ok"))
    except Exception as e:  # noqa: BLE001
        _log(f"ma 失败：{e}\n{traceback.format_exc()}")
        exit_code = max(exit_code, 2)

    # ── 总结 ──
    n_spot = get_spot_count()
    n_ma = get_ma_count()
    _log(f"=== 完成：spot={n_spot} 只 / ma={n_ma} 只 "
         f"(spot_{'ok' if spot_ok else 'FAIL'} ma_{'ok' if ma_ok else 'FAIL'}) ===")

    if not spot_ok and not ma_ok:
        return 3
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
