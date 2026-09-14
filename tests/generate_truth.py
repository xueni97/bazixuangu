# -*- coding: utf-8 -*-
"""生成命理引擎真值 JSON，供 JS 测试对比。
运行：python tests/generate_truth.py（用 .venv 解释器）
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, r'c:\SVN\Seq\Sequoia-X')
from sequoia_x.strategy.metaphysics import (  # noqa: E402
    BaziEngine, StockElementAnalyzer, YuanhaiDecisionModel,
)

# 测试日期样本（覆盖立春边界、夜子时、各季节）
TEST_DATES = [
    (2026, 9, 14, 12),
    (2026, 1, 20, 10),        # 立春前（属上一年）
    (2026, 2, 10, 14),        # 立春后
    (2026, 7, 15, 23, 30),    # 夏月 + 夜子时
    (2026, 12, 1, 8),         # 冬月
    (2026, 3, 21, 9),         # 春分
    (2026, 10, 8, 15),        # 秋月（寒露附近）
    (2026, 5, 6, 11),         # 立夏
]

date_samples = []
for d in TEST_DATES:
    dt = datetime(*d)
    pillars = BaziEngine.from_datetime(dt)
    analysis = YuanhaiDecisionModel.analyze(pillars)
    date_samples.append({
        'date': list(d),
        'pillars': str(pillars),
        'dayMaster': analysis.day_master,
        'dayMasterElement': analysis.day_master_element,
        'dayMasterStrength': analysis.day_master_strength,
        'useGods': analysis.use_gods,
        'avoidGods': analysis.avoid_gods,
        'toneGod': analysis.tone_god,
        'elementsStrength': analysis.elements_strength,
        'elementScores': analysis.element_scores,
        'tenGods': analysis.ten_gods_of_pillars,
    })

STOCKS = ['贵州茅台', '平安银行', '宁德时代', '中国石化', '招商银行',
          '比亚迪', '隆基绿能', '京东方A', '工商银行', '药明康德']

stock_out = []
for name in STOCKS:
    elem = StockElementAnalyzer.combined_element(name)
    profile = StockElementAnalyzer.element_profile(name)
    stock_out.append({'name': name, 'element': elem, 'profile': profile})

# 综合评分样本（用 2026-09-14 12:00 的周期分析）
dt = datetime(2026, 9, 14, 12)
period_data = YuanhaiDecisionModel.period_analyses(dt)
score_out = []
for name in STOCKS:
    elem = StockElementAnalyzer.combined_element(name)
    if not elem:
        continue
    info = YuanhaiDecisionModel.composite_score(
        elem, period_data, ['monthly', 'weekly', 'daily'], name)
    score_out.append({
        'name': name, 'element': elem,
        'score': info['score'], 'level': info['level'],
        'periodScores': {k: v['score'] for k, v in info['periodScores'].items()},
    })

# 方向分析样本
direction_out = {
    'daily': {k: v for k, v in YuanhaiDecisionModel.daily_direction(dt).items()
              if k in ('date', 'day_master', 'day_master_strength',
                       'use_gods', 'avoid_gods', 'tone_god')},
    'buyPoint': {k: v for k, v in YuanhaiDecisionModel.buy_point_signal(dt).items()
                 if k in ('signal_score', 'action')},
}

truth = {
    'dates': date_samples,
    'stocks': stock_out,
    'scores': score_out,
    'directions': direction_out,
}

target = Path(__file__).resolve().parent / 'metaphysics_truth.json'
target.write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding='utf-8')
print('真值已生成:', target)
print('日期样本 %d / 股票 %d / 评分 %d' % (
    len(date_samples), len(stock_out), len(score_out)))
