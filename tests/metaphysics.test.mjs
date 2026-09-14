/**
 * 命理引擎 JS 重写正确性测试。
 * 对比 tests/metaphysics_truth.json（由 Python 生成）验证 JS 输出一致。
 * 运行：node tests/metaphysics.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { BaziEngine } from '../src/lib/metaphysics/bazi.js'
import { StockElementAnalyzer } from '../src/lib/metaphysics/stockElement.js'
import { YuanhaiDecisionModel } from '../src/lib/metaphysics/model.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const truth = JSON.parse(readFileSync(join(__dirname, 'metaphysics_truth.json'), 'utf-8'))

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
  } else {
    fail++
    console.error('  FAIL:', msg)
  }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 1. 四柱排盘 + 八字分析 ──
for (const s of truth.dates) {
  const [y, m, d, ...rest] = s.date
  const hour = rest[0] ?? 12
  const minute = rest[1] ?? 0
  const dt = new Date(y, m - 1, d, hour, minute)
  const pillars = BaziEngine.fromDatetime(dt)
  ok(String(pillars) === s.pillars,
    `四柱 ${s.date}: ${String(pillars)} !== ${s.pillars}`)

  const a = YuanhaiDecisionModel.analyze(pillars)
  ok(a.dayMaster === s.dayMaster, `日主 ${s.date}`)
  ok(a.dayMasterElement === s.dayMasterElement, `日主五行 ${s.date}`)
  ok(a.dayMasterStrength === s.dayMasterStrength,
    `旺衰 ${s.date}: ${a.dayMasterStrength} !== ${s.dayMasterStrength}`)
  ok(eq(a.useGods, s.useGods), `用神 ${s.date}: ${a.useGods} !== ${s.useGods}`)
  ok(eq(a.avoidGods, s.avoidGods), `忌神 ${s.date}`)
  ok(a.toneGod === s.toneGod, `调候 ${s.date}: ${a.toneGod} !== ${s.toneGod}`)
  ok(eq(a.elementsStrength, s.elementsStrength), `月令旺衰 ${s.date}`)
  ok(eq(a.tenGodsOfPillars, s.tenGods), `十神 ${s.date}`)
  // elementScores 浮点近似
  let scoresOk = true
  for (const k of Object.keys(s.elementScores)) {
    if (!approx(a.elementScores[k], s.elementScores[k])) {
      scoresOk = false
      console.error('    score diff', k, a.elementScores[k], s.elementScores[k])
    }
  }
  ok(scoresOk, `五行得分 ${s.date}`)
}

// ── 2. 股票五行 ──
for (const s of truth.stocks) {
  const elem = StockElementAnalyzer.combinedElement(s.name)
  ok(elem === s.element, `五行 ${s.name}: ${elem} !== ${s.element}`)
  const profile = StockElementAnalyzer.elementProfile(s.name)
  ok(eq(profile, s.profile), `五行分布 ${s.name}: ${JSON.stringify(profile)} !== ${JSON.stringify(s.profile)}`)
}

// ── 3. 多周期综合评分 ──
const dt = new Date(2026, 8, 14, 12) // 2026-09-14 12:00
const periodData = YuanhaiDecisionModel.periodAnalyses(dt)
for (const s of truth.scores) {
  const elem = StockElementAnalyzer.combinedElement(s.name)
  const info = YuanhaiDecisionModel.compositeScore(
    elem, periodData, ['monthly', 'weekly', 'daily'], s.name)
  ok(info.score === s.score, `评分 ${s.name}: ${info.score} !== ${s.score}`)
  ok(info.level === s.level, `等级 ${s.name}: ${info.level} !== ${s.level}`)
  let psOk = true
  for (const k of Object.keys(s.periodScores)) {
    if (info.periodScores[k].score !== s.periodScores[k]) {
      psOk = false
      console.error('    period', k, info.periodScores[k].score, s.periodScores[k])
    }
  }
  ok(psOk, `分项 ${s.name}`)
}

// ── 4. 方向 + 买点 ──
// 注意：Python 真值用 snake_case，JS 返回 camelCase
const daily = YuanhaiDecisionModel.dailyDirection(dt)
ok(daily.dayMaster === truth.directions.daily.day_master, 'daily 日主')
ok(daily.dayMasterStrength === truth.directions.daily.day_master_strength, 'daily 旺衰')
ok(eq(daily.useGods, truth.directions.daily.use_gods), 'daily 用神')
ok(eq(daily.avoidGods, truth.directions.daily.avoid_gods), 'daily 忌神')
ok(daily.toneGod === truth.directions.daily.tone_god, 'daily 调候')

const bp = YuanhaiDecisionModel.buyPointSignal(dt)
ok(bp.signalScore === truth.directions.buyPoint.signal_score,
  `买点分数: ${bp.signalScore} !== ${truth.directions.buyPoint.signal_score}`)
ok(bp.action === truth.directions.buyPoint.action,
  `买点动作: ${bp.action} !== ${truth.directions.buyPoint.action}`)

console.log(`\n命理引擎测试: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
