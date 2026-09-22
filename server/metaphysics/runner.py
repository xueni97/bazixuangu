"""渊海子平命理选股 - 命令行入口。

用法：
  python -m sequoia_x.strategy.metaphysics.runner              # 生成当日报告
  python -m sequoia_x.strategy.metaphysics.runner --date 2026-09-12  # 指定日期
  python -m sequoia_x.strategy.metaphysics.runner --scan             # 扫描本地股票库
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime

from . import BaziEngine, StockElementAnalyzer, YuanhaiDecisionModel, run_report


def main() -> None:
    parser = argparse.ArgumentParser(description="渊海子平命理选股决策")
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="指定日期 YYYY-MM-DD（默认今天）",
    )
    parser.add_argument(
        "--hour",
        type=int,
        default=12,
        help="指定时辰（0-23，默认12点午时）",
    )
    parser.add_argument(
        "--scan",
        action="store_true",
        help="扫描本地股票库，按用神评分排序输出",
    )
    args = parser.parse_args()

    # 解析日期时间
    if args.date:
        try:
            dt = datetime.strptime(args.date, "%Y-%m-%d")
            dt = dt.replace(hour=args.hour)
        except ValueError:
            print(f"日期格式错误：{args.date}，应为 YYYY-MM-DD")
            sys.exit(1)
    else:
        dt = datetime.now()

    # 生成报告
    report = run_report(dt)
    print(report)

    # 扫描模式
    if args.scan:
        _scan_local_stocks(dt)


def _ensure_stock_names(db_path: Path) -> None:
    """确保 stock_names 表存在并填充数据。"""
    import sqlite3

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS stock_names ("
            "symbol TEXT PRIMARY KEY, name TEXT, industry TEXT)"
        )
        count = conn.execute("SELECT COUNT(*) FROM stock_names").fetchone()[0]

    if count > 0:
        return

    # 通过 baostock 获取股票名称
    print("  正在获取股票名称列表...")
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

        with sqlite3.connect(db_path) as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO stock_names (symbol, name, industry) VALUES (?, ?, ?)",
                rows,
            )
            conn.commit()
        print(f"  已缓存 {len(rows)} 只股票名称")
    except Exception as e:
        print(f"  获取股票名称失败：{e}")


def _scan_local_stocks(dt: datetime) -> None:
    """扫描本地数据库中的股票，按用神评分排序。"""
    import sqlite3
    from pathlib import Path

    db_path = Path("data/sequoia_v2.db")
    if not db_path.exists():
        print("\n[!] 本地数据库不存在，请先运行 --backfill 拉取数据")
        return

    # 确保有股票名称
    _ensure_stock_names(db_path)

    # 当日命理分析
    pillars = BaziEngine.from_datetime(dt)
    analysis = YuanhaiDecisionModel.analyze(pillars)

    print("\n" + "=" * 60)
    print(f"  本地股票库扫描（用神：{' '.join(analysis.use_gods[:3])}）")
    print("=" * 60)

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT s.symbol, n.name FROM stock_daily s "
            "LEFT JOIN stock_names n ON s.symbol = n.symbol "
            "GROUP BY s.symbol ORDER BY s.symbol"
        ).fetchall()

    results = []
    for symbol, name in rows:
        name = name or symbol
        elem = StockElementAnalyzer.combined_element(name)
        if elem is None:
            continue
        info = YuanhaiDecisionModel.stock_score(elem, analysis, stock_name=name)
        if info["score"] >= 10:
            results.append((symbol, name, elem, info["score"], info["level"]))

    results.sort(key=lambda x: x[3], reverse=True)

    print(f"  共扫描 {len(rows)} 只，命中 {len(results)} 只")
    print("  " + "-" * 56)
    print(f"  {'代码':8s} {'名称':10s} {'五行':4s} {'评分':>6s} {'评级':8s}")
    print("  " + "-" * 56)
    for symbol, name, elem, score, level in results[:50]:
        print(f"  {symbol:8s} {name:10s} {elem:4s} {score:>+6.1f} {level:8s}")

    if len(results) > 50:
        print(f"  ... 共 {len(results)} 只，仅显示前 50 只")


if __name__ == "__main__":
    main()
