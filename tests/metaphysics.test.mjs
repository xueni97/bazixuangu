/**
 * 命理引擎 + 取象 + 自选结算 测试。
 *
 * 1. 四柱排盘与 analyze 核心字段（对 Python 真值，方向页面依赖，逐分锁定）
 * 2. 新增：喜用天干 / 调候干 / 十神名结构
 * 3. 十干 + 十神取象画像
 * 4. 新打分卡（合成喜用/忌神画像）与多周期共振
 * 5. 自选 T+1 结算纯函数
 *
 * 运行：node --test tests/metaphysics.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { BaziEngine } from '../src/lib/metaphysics/bazi.js'
import { StockElementAnalyzer } from '../src/lib/metaphysics/stockElement.js'
import { YuanhaiDecisionModel } from '../src/lib/metaphysics/model.js'
import { StockImageryAnalyzer } from '../src/lib/metaphysics/imagery.js'
import { STEM_IMAGERY } from '../src/lib/metaphysics/imageryData.js'
import { STEM_ELEMENT, STEMS } from '../src/lib/metaphysics/elements.js'
import {
  evaluateNextBar, groupRecords, overallStats,
} from '../src/lib/watchlist.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const truth = JSON.parse(readFileSync(join(__dirname, 'metaphysics_truth.json'), 'utf-8'))

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

// ── 1. 四柱排盘 + 八字分析核心字段（对 Python 真值） ──
for (const s of truth.dates) {
  const [y, m, d, ...rest] = s.date
  const hour = rest[0] ?? 12
  const minute = rest[1] ?? 0
  const dt = new Date(y, m - 1, d, hour, minute)
  const pillars = BaziEngine.fromDatetime(dt)

  test(`四柱 ${s.date}`, () => {
    assert.equal(String(pillars), s.pillars)
  })

  const a = YuanhaiDecisionModel.analyze(pillars)
  test(`分析 ${s.date} 核心字段`, () => {
    assert.equal(a.dayMaster, s.dayMaster)
    assert.equal(a.dayMasterElement, s.dayMasterElement)
    assert.equal(a.dayMasterStrength, s.dayMasterStrength)
    assert.deepEqual(a.useGods, s.useGods)
    assert.deepEqual(a.avoidGods, s.avoidGods)
    assert.equal(a.toneGod, s.toneGod)
    assert.deepEqual(a.elementsStrength, s.elementsStrength)
    assert.deepEqual(a.tenGodsOfPillars, s.tenGods)
    for (const k of Object.keys(s.elementScores)) {
      assert.ok(approx(a.elementScores[k], s.elementScores[k]), `五行得分 ${k}`)
    }
  })
}

// ── 2. 喜用天干 / 调候干 / 十神名 ──
test('analyze 新增十干十神字段结构完整', () => {
  const pillars = BaziEngine.fromDatetime(new Date(2026, 8, 14, 12))
  const a = YuanhaiDecisionModel.analyze(pillars)
  assert.equal(a.useStems.length, a.useGods.length)
  for (const u of a.useStems) {
    assert.ok(['木', '火', '土', '金', '水'].includes(u.elem))
    assert.equal(u.pair.length, 2)
    for (const st of u.pair) assert.equal(STEM_ELEMENT[st], u.elem)
    if (u.preferred) {
      assert.ok(u.pair.includes(u.preferred))
      assert.ok(['透干', '调候', '日主自旺'].includes(u.reason))
    }
  }
  // 身旺喜6忌4（官杀食伤财 vs 印比），身弱喜4忌6，合计十神不重叠
  assert.equal(a.useGodNames.length + a.avoidGodNames.length, 10)
  for (const g of a.useGodNames) assert.ok(!a.avoidGodNames.includes(g))
  assert.ok(STEMS.includes(a.toneStem))
  assert.equal(STEM_ELEMENT[a.toneStem], a.toneGod)
})

test('调候干：冬月丙火、夏月壬水、春月庚金、秋月丙火', () => {
  const cases = [
    [[2026, 0, 15], '丙'], // 丑月冬
    [[2026, 6, 15], '壬'], // 未月夏
    [[2026, 2, 15], '庚'], // 卯月春
    [[2026, 9, 15], '丙'], // 戌月秋
  ]
  for (const [[y, m, d], expectStem] of cases) {
    const a = YuanhaiDecisionModel.analyze(BaziEngine.fromDatetime(new Date(y, m, d, 12)))
    assert.equal(a.toneStem, expectStem)
  }
})

// ── 3. 十干 + 十神取象 ──
const IMG_CASES = [
  ['中芯国际', '丁', ['伤官']],
  ['招商银行', '辛', ['正财']],
  ['中国船舶', '庚', []],
  ['航天彩虹', '庚', ['七杀']],
  ['长江电力', '丙', ['正官']],
  ['中国石油', '丙', []],
  ['中国建筑', '戊', []],
  ['宝钢股份', '庚', []],
  ['光明乳业', '癸', ['食神']],
  ['分众传媒', '丙', ['食神']],
  ['圆通速递', '癸', []],
  ['牧原股份', '己', []],
]
for (const [name, stem, gods] of IMG_CASES) {
  test(`取象 ${name} → ${stem}${gods.length ? '/' + gods.join(',') : ''}`, () => {
    const img = StockImageryAnalyzer.analyze(name)
    assert.ok(img, `${name} 应能识别`)
    assert.equal(img.primaryStem, stem)
    assert.equal(img.element, STEM_ELEMENT[stem])
    assert.equal(img.stemLabel, STEM_IMAGERY[stem].label)
    for (const g of gods) assert.ok(img.godNames.includes(g), `${name} 应含十神 ${g}`)
  })
}

test('取象：无字可识别返回 null', () => {
  assert.equal(StockImageryAnalyzer.analyze('ABC'), null)
})

test('取象：多干投票时次象入选，五行便捷法可用', () => {
  const img = StockImageryAnalyzer.analyze('中国医药')
  assert.equal(img.primaryStem, '甲')
  assert.ok(img.secondaryStems.includes('乙'))
  assert.ok(img.godNames.includes('正印'))
  assert.equal(StockImageryAnalyzer.combinedElement('招商银行'), '金')
})

test('旧 StockElementAnalyzer 行为不变（对真值）', () => {
  for (const s of truth.stocks) {
    assert.equal(StockElementAnalyzer.combinedElement(s.name), s.element)
    assert.deepEqual(StockElementAnalyzer.elementProfile(s.name), s.profile)
  }
})

// ── 4. 新打分卡 ──
function fakeImg(stem, god) {
  return {
    name: '',
    primaryStem: stem,
    element: STEM_ELEMENT[stem],
    stemLabel: STEM_IMAGERY[stem].label,
    gods: god ? [{ name: god, strength: 1 }] : [],
    godNames: god ? [god] : [],
    totalCharVotes: 0,
  }
}

test('打分：喜用透干 + 喜十神为高分，忌神为低分', () => {
  for (const s of truth.dates.slice(0, 6)) {
    const [y, m, d, h = 12] = s.date
    const a = YuanhaiDecisionModel.analyze(BaziEngine.fromDatetime(new Date(y, m - 1, d, h)))
    const pref = a.useStems.find((u) => u.preferred) || a.useStems[0]
    const goodImg = fakeImg(pref.preferred || pref.pair[0], a.useGodNames[0])
    const good = YuanhaiDecisionModel.stockScore(goodImg, a)
    assert.ok(good.score >= 55, `喜用分应≥55，实际 ${good.score}`)
    assert.ok(good.reason.includes('喜用'))

    const badStem = STEMS.find((st) => STEM_ELEMENT[st] === a.avoidGods[0])
    const badImg = fakeImg(badStem, a.avoidGodNames[0])
    const bad = YuanhaiDecisionModel.stockScore(badImg, a)
    assert.ok(bad.score <= -40, `忌神分应≤-40，实际 ${bad.score}`)
    assert.ok(bad.score >= -100 && good.score <= 100)
  }
})

test('打分：同五行阴阳异干低于正选干', () => {
  const a = YuanhaiDecisionModel.analyze(BaziEngine.fromDatetime(new Date(2026, 8, 14, 12)))
  const u = a.useStems.find((x) => x.preferred)
  if (u) {
    const other = u.pair.find((st) => st !== u.preferred)
    const s1 = YuanhaiDecisionModel.stockScore(fakeImg(u.preferred), a).score
    const s2 = YuanhaiDecisionModel.stockScore(fakeImg(other), a).score
    assert.ok(s1 > s2)
  }
})

test('综合评分确定且共振加分，方向/买点输出不回归', () => {
  const dt = new Date(2026, 8, 14, 12)
  const periodData = YuanhaiDecisionModel.periodAnalyses(dt)
  const img = StockImageryAnalyzer.analyze('中芯国际')
  const i1 = YuanhaiDecisionModel.compositeScore(img, periodData, ['monthly', 'weekly', 'daily'])
  const i2 = YuanhaiDecisionModel.compositeScore(img, periodData, ['monthly', 'weekly', 'daily'])
  assert.equal(i1.score, i2.score)
  assert.ok(i1.score >= -100 && i1.score <= 100)
  assert.ok(i1.periodScores.monthly && i1.periodScores.weekly && i1.periodScores.daily)

  const daily = YuanhaiDecisionModel.dailyDirection(dt)
  assert.equal(daily.dayMaster, truth.directions.daily.day_master)
  assert.equal(daily.toneStem, '丙') // 2026-09-14 白露后酉月，秋金喜丙火锻炼
  const bp = YuanhaiDecisionModel.buyPointSignal(dt)
  assert.equal(bp.signalScore, truth.directions.buyPoint.signal_score)
  assert.equal(bp.action, truth.directions.buyPoint.action)
})

test('月方向推荐板块按五行分组且每组有内容', () => {
  const m = YuanhaiDecisionModel.monthlyDirection(new Date(2026, 8, 14))
  for (const e of Object.keys(m.recommendedSectors)) {
    assert.ok(m.recommendedSectors[e].length > 0)
  }
})

// ── 5. 自选 T+1 结算 ──
const baseRec = { id: '2026-09-16_600000', signalDate: '2026-09-16', symbol: '600000',
  name: '测试', entryPrice: 10, status: 'pending' }

test('结算：次日上涨 win、下跌 lose、持平 flat、无新K线仍 pending', () => {
  const win = evaluateNextBar(baseRec, [['2026-09-16', 10], ['2026-09-17', 10.5]])
  assert.equal(win.result, 'win')
  assert.equal(win.pnlPct, 5)
  assert.equal(win.nextTradeDate, '2026-09-17')

  const lose = evaluateNextBar(baseRec, [['2026-09-17', 9.5]])
  assert.equal(lose.result, 'lose')
  assert.equal(lose.pnlPct, -5)

  const flat = evaluateNextBar(baseRec, [['2026-09-17', 10.0005]])
  assert.equal(flat.result, 'flat')

  const pending = evaluateNextBar(baseRec, [['2026-09-15', 9.8], ['2026-09-16', 10]])
  assert.equal(pending, null)

  assert.equal(evaluateNextBar({ ...baseRec, status: 'settled' }, [['2026-09-17', 11]]), null)
})

test('统计：分组胜率、平均涨跌与连红', () => {
  const recs = [
    { ...baseRec, id: '2026-09-16_a', symbol: 'a', score: 80, status: 'settled', result: 'win', pnlPct: 3, source: 'auto', filtersLabel: '月周日·火' },
    { ...baseRec, id: '2026-09-16_b', symbol: 'b', score: 70, status: 'settled', result: 'win', pnlPct: 1, source: 'manual', filtersLabel: '月周日·火' },
    { ...baseRec, id: '2026-09-15_c', symbol: 'c', signalDate: '2026-09-15', score: 90, status: 'settled', result: 'win', pnlPct: 6, source: 'auto', filtersLabel: '日' },
    { ...baseRec, id: '2026-09-15_d', symbol: 'd', signalDate: '2026-09-15', score: 60, status: 'settled', result: 'win', pnlPct: 1, source: 'manual', filtersLabel: '日' },
    { ...baseRec, id: '2026-09-17_e', symbol: 'e', signalDate: '2026-09-17', status: 'pending', result: null, pnlPct: null, source: 'auto', filtersLabel: '月周日' },
  ]
  const stats = overallStats(recs)
  assert.equal(stats.win, 4)
  assert.equal(stats.lose, 0)
  assert.equal(stats.winrate, 100)
  assert.equal(stats.pending, 1)
  assert.equal(stats.streak.dir, 'red')
  assert.equal(stats.streak.n, 2)
  const g0 = groupRecords(recs)[0]
  assert.equal(g0.date, '2026-09-17')
  assert.equal(g0.pending, 1)
})
