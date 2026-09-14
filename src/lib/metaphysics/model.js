/**
 * 渊海子平决策模型。
 *
 * 由 sequoia_x/strategy/metaphysics/model.py 忠实翻译。
 * 核心逻辑（参考《渊海子平》《子平真诠》）：
 * 1. 以当日四柱为"市场命盘"，月令为提纲
 * 2. 判断五行旺衰：得令、得地、得势
 * 3. 定用神（扶抑 + 调候）
 * 4. 评分模型：用神匹配度
 * 5. 输出周/月/日方向与买点
 *
 * 时间入参统一为 JS Date 对象（与 bazi.js fromDatetime 一致）。
 */

import { BaziEngine } from './bazi.js'
import { StockElementAnalyzer } from './stockElement.js'
import {
  STEM_ELEMENT,
  BRANCH_ELEMENT,
  BRANCH_HIDDEN_STEMS,
  GENERATE,
  RESTRAIN,
  GENERATED_BY,
  RESTRAINED_BY,
  STRENGTH_SCORE,
  elementStrengthInMonth,
  tenGod,
  tenGodElement,
} from './elements.js'

const ELEMENTS = ['木', '火', '土', '金', '水']

const WEEKDAY_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function _fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// 模拟 Python3 round：四舍六入五成双（half to even）
// Python round(2.5)=2, round(3.5)=4；JS Math.round 对 .5 一律向上，需手动修正
function pyRound(x) {
  const fl = Math.floor(x)
  const frac = x - fl
  if (Math.abs(frac - 0.5) < 1e-9) {
    // .5：向偶数取整
    return (Math.abs(fl) % 2 === 0) ? fl : fl + 1
  }
  return Math.round(x)
}
function pyRoundN(x, n) {
  if (n === 0) return pyRound(x)
  const f = Math.pow(10, n)
  return pyRound(x * f) / f
}

function _fmtDateTime(dt) {
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${_fmtDate(dt)} ${hh}:${mm}`
}

/** 各周期的代表时点：日=当时，周=本周一，月=当月1号。 */
function _periodDatetime(dt, period) {
  if (period === 'daily') return dt
  if (period === 'weekly') {
    const pyWd = (dt.getDay() + 6) % 7 // 周一=0（JS getDay 周日=0）
    const monday = new Date(dt)
    monday.setDate(dt.getDate() - pyWd)
    monday.setHours(dt.getHours(), 0, 0, 0)
    return monday
  }
  if (period === 'monthly') {
    return new Date(dt.getFullYear(), dt.getMonth(), 1, 0, 0, 0, 0)
  }
  throw new Error(`未知周期: ${period}`)
}

function _scoreLevel(score) {
  if (score >= 45) return '强烈推荐'
  if (score >= 15) return '推荐'
  if (score >= -10) return '中性'
  if (score >= -35) return '谨慎'
  return '回避'
}

export class YuanhaiDecisionModel {
  /** 渊海子平决策模型。 */

  /** 分析四柱八字，确定用神忌神。返回 BaziAnalysis 普通对象。 */
  static analyze(pillars) {
    const dayMaster = pillars.day.stem
    const dayElem = STEM_ELEMENT[dayMaster]
    const monthBranch = pillars.month.branch

    // ── 1. 统计五行得分 ──
    const elementScores = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
    const elementsStrength = {}

    // 月令旺衰表
    for (const elem of ELEMENTS) {
      const strength = elementStrengthInMonth(monthBranch, elem)
      elementsStrength[elem] = strength
      elementScores[elem] += STRENGTH_SCORE[strength]
    }

    // 天干计分（权重 1.0）
    for (const p of pillars.pillars()) {
      const e = STEM_ELEMENT[p.stem]
      elementScores[e] += 1.0
    }

    // 地支藏干计分（本气 1.0，中气 0.5，余气 0.3）
    for (const p of pillars.pillars()) {
      const hidden = BRANCH_HIDDEN_STEMS[p.branch]
      for (let i = 0; i < hidden.length; i++) {
        const stem = hidden[i]
        const e = STEM_ELEMENT[stem]
        const weight = i < 3 ? [1.0, 0.5, 0.3][i] : 0.2
        elementScores[e] += weight
      }
    }

    // ── 2. 判断日主旺衰 ──
    const dmStrengthInMonth = elementsStrength[dayElem]
    const deMingling = dmStrengthInMonth === '旺' || dmStrengthInMonth === '相'

    // 得地：日主五行在地支中有根
    let deDedi = 0
    for (const p of pillars.pillars()) {
      if (BRANCH_ELEMENT[p.branch] === dayElem) {
        deDedi += 1
      } else {
        for (const h of BRANCH_HIDDEN_STEMS[p.branch]) {
          if (STEM_ELEMENT[h] === dayElem) deDedi += 0.3
        }
      }
    }
    const deDediBool = deDedi >= 1.0

    // 得势：天干中有比劫帮身
    let deDeshi = 0
    for (const p of pillars.pillars()) {
      if (p === pillars.day) continue
      if (STEM_ELEMENT[p.stem] === dayElem) deDeshi += 1
    }
    const deDeshiBool = deDeshi >= 1

    // 综合判断
    let dayMasterStrength = (deMingling && (deDediBool || deDeshiBool)) ? '旺' : '弱'
    if (deMingling && deDediBool && deDeshiBool) dayMasterStrength = '极旺'

    // ── 3. 定用神（扶抑用神） ──
    const useGods = []
    const avoidGods = []

    const addUse = (gods) => {
      for (const god of gods) {
        const ge = tenGodElement(dayMaster, god)
        if (ge && !useGods.includes(ge)) useGods.push(ge)
      }
    }
    const addAvoid = (gods) => {
      for (const god of gods) {
        const ge = tenGodElement(dayMaster, god)
        if (ge && !avoidGods.includes(ge)) avoidGods.push(ge)
      }
    }

    if (dayMasterStrength === '旺' || dayMasterStrength === '极旺') {
      // 身旺：用神为克我(官杀)、我生(食伤)、我克(财星)
      addUse(['正官', '七杀', '食神', '伤官', '正财', '偏财'])
      addAvoid(['正印', '偏印', '比肩', '劫财'])
    } else {
      // 身弱：用神为生我(印星)、同我(比劫)
      addUse(['正印', '偏印', '比肩', '劫财'])
      addAvoid(['正官', '七杀', '食神', '伤官', '正财', '偏财'])
    }

    // ── 4. 调候用神 ──
    let toneGod = undefined
    if (['亥', '子', '丑'].includes(monthBranch)) {
      toneGod = '火'
      if (!useGods.includes('火')) useGods.unshift('火')
    } else if (['巳', '午', '未'].includes(monthBranch)) {
      toneGod = '水'
      if (!useGods.includes('水')) useGods.unshift('水')
    } else if (['寅', '卯', '辰'].includes(monthBranch)) {
      toneGod = '金'
      if (!useGods.includes('金')) useGods.unshift('金')
    } else if (['申', '酉', '戌'].includes(monthBranch)) {
      toneGod = '火'
      if (!useGods.includes('火')) useGods.unshift('火')
    }

    // ── 5. 各柱十神 ──
    const tenGodsOfPillars = {}
    for (const [name, p] of [['年', pillars.year], ['月', pillars.month],
    ['日', pillars.day], ['时', pillars.hour]]) {
      tenGodsOfPillars[name] = tenGod(dayMaster, p.stem)
    }

    return {
      pillars,
      dayMaster,
      dayMasterElement: dayElem,
      monthBranch,
      monthCommandElement: BRANCH_ELEMENT[monthBranch],
      dayMasterStrength,
      useGods,
      avoidGods,
      elementScores,
      elementsStrength,
      tenGodsOfPillars,
      toneGod,
    }
  }

  /**
   * 根据股票五行与用神匹配度评分。
   * 返回 {score, level, reason}，score: -100 ~ 100。
   */
  static stockScore(stockElement, analysis, stockName = undefined) {
    if (stockElement === undefined || stockElement === null) {
      return { score: 0, level: '中性', reason: '五行属性不明' }
    }

    const { useGods, avoidGods, toneGod } = analysis

    let score = 0
    const reasons = []

    // 用神匹配
    if (useGods.includes(stockElement)) {
      if (stockElement === toneGod) {
        score += 40
        reasons.push(`${stockElement}为调候用神`)
      } else {
        const rank = useGods.indexOf(stockElement)
        score += Math.max(30 - rank * 8, 12)
        reasons.push(`${stockElement}为扶抑用神(第${rank + 1}位)`)
      }
    } else if (avoidGods.includes(stockElement)) {
      const rank = avoidGods.indexOf(stockElement)
      score -= Math.max(30 - rank * 8, 12)
      reasons.push(`${stockElement}为忌神(第${rank + 1}位)`)
    } else {
      // 闲神：看与用神的关系
      if (GENERATE[stockElement] && useGods.includes(GENERATE[stockElement])) {
        score += 12
        reasons.push(`${stockElement}生用神(${GENERATE[stockElement]})`)
      } else if (RESTRAIN[stockElement] && useGods.includes(RESTRAIN[stockElement])) {
        score -= 18
        reasons.push(`${stockElement}克用神(${RESTRAIN[stockElement]})`)
      } else if (GENERATED_BY[stockElement] && useGods.includes(GENERATED_BY[stockElement])) {
        score -= 8
        reasons.push(`${stockElement}为用神所生`)
      } else {
        reasons.push(`${stockElement}为闲神`)
      }
    }

    // 名称字符级匹配度加成
    if (stockName) {
      for (const target of useGods.slice(0, 2)) {
        const charScore = StockElementAnalyzer.scoreByElement(stockName, target)
        if (charScore > 0) {
          const bonus = Math.floor(charScore * 30)
          score += bonus
          if (bonus > 0) {
            reasons.push(`名称含${target}气(${charScore.toFixed(2)})`)
          }
          break
        }
      }
    }

    // 月令旺衰加成
    const strength = analysis.elementsStrength[stockElement] || '休'
    if (strength === '旺') {
      score += 8
      reasons.push('得月令旺气')
    } else if (strength === '相') {
      score += 4
    } else if (strength === '死') {
      score -= 8
      reasons.push('月令处死地')
    }

    score = Math.max(-100, Math.min(100, score))
    return { score, level: _scoreLevel(score), reason: reasons.join('；') }
  }

  // ── 多周期叠加综合评分 ─────────────────────────────────────
  static PERIOD_WEIGHTS = { monthly: 0.5, weekly: 0.3, daily: 0.2 }
  static PERIOD_LABELS = { monthly: '月', weekly: '周', daily: '日' }

  /** 返回日/周/月三个代表时点的四柱与用神分析（扫描时只算一次）。 */
  static periodAnalyses(dt) {
    const out = {}
    for (const key of ['monthly', 'weekly', 'daily']) {
      const pdt = _periodDatetime(dt, key)
      const pillars = BaziEngine.fromDatetime(pdt)
      out[key] = {
        date: _fmtDate(pdt),
        pillars,
        analysis: YuanhaiDecisionModel.analyze(pillars),
      }
    }
    return out
  }

  /**
   * 多周期加权综合评分 + 同向共振加成。
   * periodData: periodAnalyses() 的返回值
   * selected: 勾选周期，如 ['monthly','weekly','daily']
   * 返回 {score, level, reason, periodScores}
   */
  static compositeScore(stockElement, periodData, selected, stockName = undefined, weights = undefined) {
    const w = weights || YuanhaiDecisionModel.PERIOD_WEIGHTS
    const chosen = ['monthly', 'weekly', 'daily'].filter(p => selected.includes(p)) || ['daily']
    const totalW = chosen.reduce((s, p) => s + w[p], 0)

    const periodScores = {}
    let weighted = 0.0
    for (const p of chosen) {
      const info = YuanhaiDecisionModel.stockScore(
        stockElement, periodData[p].analysis, stockName)
      periodScores[p] = info
      weighted += w[p] * info.score / totalW
    }

    let score = weighted
    // 共振加成
    const raws = chosen.map(p => periodScores[p].score)
    let resonance = ''
    if (chosen.length > 1) {
      const label = chosen.map(p => YuanhaiDecisionModel.PERIOD_LABELS[p]).join('')
      if (Math.min(...raws) >= 45) {
        score += 15
        resonance = `${label}周期强烈共振`
      } else if (Math.min(...raws) >= 15) {
        score += 8
        resonance = `${label}周期共振看多`
      } else if (Math.max(...raws) <= -35) {
        score -= 15
        resonance = `${label}周期共振回避`
      } else if (Math.max(...raws) <= -15) {
        score -= 8
        resonance = `${label}周期共振走弱`
      }
    }

    score = Math.max(-100, Math.min(100, pyRound(score)))
    // 综合理由：共振结论 + 权重最高周期的分项理由
    const anchor = chosen.reduce((a, p) => w[p] > w[a] ? p : a, chosen[0])
    const anchorReason = periodScores[anchor].reason
    const reason = [resonance, anchorReason].filter(Boolean).join('；')

    return {
      score,
      level: _scoreLevel(score),
      reason,
      periodScores,
    }
  }

  /** 当日方向分析。 */
  static dailyDirection(dt) {
    const pillars = BaziEngine.fromDatetime(dt)
    const analysis = YuanhaiDecisionModel.analyze(pillars)
    return {
      date: _fmtDate(dt),
      weekday: WEEKDAY_EN[dt.getDay()],
      pillars: String(pillars),
      dayMaster: analysis.dayMaster,
      dayMasterElement: analysis.dayMasterElement,
      monthCommand: analysis.monthBranch,
      dayMasterStrength: analysis.dayMasterStrength,
      useGods: analysis.useGods,
      avoidGods: analysis.avoidGods,
      toneGod: analysis.toneGod,
      elementsStrength: analysis.elementsStrength,
      elementScores: analysis.elementScores,
      recommendedElements: analysis.useGods.slice(0, 3),
      avoidElements: analysis.avoidGods.slice(0, 3),
      tenGods: analysis.tenGodsOfPillars,
    }
  }

  /** 本周方向分析（取周一为基准）。 */
  static weeklyDirection(dt) {
    const pyWd = (dt.getDay() + 6) % 7
    const monday = new Date(dt)
    monday.setDate(dt.getDate() - pyWd)
    const pillars = BaziEngine.fromDatetime(monday)
    const analysis = YuanhaiDecisionModel.analyze(pillars)

    // 统计本周各日五行倾向
    const weekDays = []
    for (let i = 0; i < 5; i++) { // 周一到周五
      const day = new Date(monday)
      day.setDate(monday.getDate() + i)
      const dp = BaziEngine.fromDatetime(day)
      const da = YuanhaiDecisionModel.analyze(dp)
      weekDays.push({
        date: _fmtDate(day),
        weekday: WEEKDAY_ABBR[day.getDay()],
        pillar: String(dp.day),
        useGods: da.useGods.slice(0, 2),
        avoidGods: da.avoidGods.slice(0, 2),
        dayMasterStrength: da.dayMasterStrength,
      })
    }

    // 统计本周用神频次
    const useGodCounter = {}
    for (const wd of weekDays) {
      for (const g of wd.useGods) useGodCounter[g] = (useGodCounter[g] || 0) + 1
    }
    const topUse = Object.entries(useGodCounter).sort((a, b) => b[1] - a[1])

    const bestDay = weekDays.reduce((a, b) =>
      b.useGods.length > a.useGods.length ? b : a, weekDays[0])

    return {
      weekStart: _fmtDate(monday),
      weekPillars: String(pillars),
      dayMaster: analysis.dayMaster,
      weekUseGods: topUse.slice(0, 3).map(x => x[0]),
      weekAvoidGods: analysis.avoidGods.slice(0, 3),
      dailyBreakdown: weekDays,
      bestDay,
    }
  }

  /** 本月方向分析（取月初为基准，以月柱为核心）。 */
  static monthlyDirection(dt) {
    const firstDay = new Date(dt.getFullYear(), dt.getMonth(), 1)
    const pillars = BaziEngine.fromDatetime(firstDay)
    const analysis = YuanhaiDecisionModel.analyze(pillars)

    const monthPillar = pillars.month
    const monthStemElem = STEM_ELEMENT[monthPillar.stem]
    const monthBranchElem = BRANCH_ELEMENT[monthPillar.branch]

    // 统计本月各周用神
    const weeklyUseCounter = {}
    const weeks = []
    for (let weekOffset = 0; weekOffset < 5; weekOffset++) {
      const weekStart = new Date(firstDay)
      weekStart.setDate(firstDay.getDate() + weekOffset * 7)
      if (weekStart.getMonth() !== dt.getMonth()) break
      const wp = BaziEngine.fromDatetime(weekStart)
      const wa = YuanhaiDecisionModel.analyze(wp)
      for (const g of wa.useGods.slice(0, 2)) {
        weeklyUseCounter[g] = (weeklyUseCounter[g] || 0) + 1
      }
      weeks.push({
        weekStart: _fmtDate(weekStart),
        useGods: wa.useGods.slice(0, 2),
        avoidGods: wa.avoidGods.slice(0, 2),
      })
    }

    const topMonthUse = Object.entries(weeklyUseCounter).sort((a, b) => b[1] - a[1])

    return {
      yearMonth: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`,
      monthPillar: String(monthPillar),
      monthStemElement: monthStemElem,
      monthBranchElement: monthBranchElem,
      dayMaster: analysis.dayMaster,
      dayMasterStrength: analysis.dayMasterStrength,
      monthUseGods: topMonthUse.slice(0, 3).map(x => x[0]),
      monthAvoidGods: analysis.avoidGods.slice(0, 3),
      toneGod: analysis.toneGod,
      weeklyBreakdown: weeks,
      recommendedSectors: YuanhaiDecisionModel._elementToSectors(
        topMonthUse.slice(0, 3).map(x => x[0])),
    }
  }

  /** 五行→推荐行业板块。 */
  static _elementToSectors(elements) {
    const sectorMap = {
      木: ['农林牧渔', '医药生物', '纺织服饰', '教育', '造纸印刷'],
      火: ['电子', '电力设备', '国防军工', '计算机', '传媒', '通信', '石油石化', '煤炭'],
      土: ['房地产', '建筑装饰', '建筑材料', '钢铁', '有色金属', '基础化工'],
      金: ['银行', '非银金融', '汽车', '机械设备', '家用电器', '食品饮料'],
      水: ['交通运输', '商贸零售', '公用事业', '环保', '社会服务'],
    }
    const out = {}
    for (const e of elements) out[e] = sectorMap[e] || []
    return out
  }

  /**
   * 买点信号分析。
   * 基于当日四柱的十神组合判断买卖时机。
   */
  static buyPointSignal(dt) {
    const pillars = BaziEngine.fromDatetime(dt)
    const analysis = YuanhaiDecisionModel.analyze(pillars)
    const dm = analysis.dayMaster

    // 统计十神出现频次
    const godCounter = {}
    for (const [name, p] of [['年', pillars.year], ['月', pillars.month],
    ['日', pillars.day], ['时', pillars.hour]]) {
      const god = tenGod(dm, p.stem)
      godCounter[god] = (godCounter[god] || 0) + 1
      // 地支藏干也算
      for (const h of BRANCH_HIDDEN_STEMS[p.branch]) {
        const g2 = tenGod(dm, h)
        godCounter[g2] = (godCounter[g2] || 0) + 0.5
      }
    }

    const wealth = (godCounter['正财'] || 0) + (godCounter['偏财'] || 0)
    const food = (godCounter['食神'] || 0) + (godCounter['伤官'] || 0)
    const officer = (godCounter['正官'] || 0) + (godCounter['七杀'] || 0)
    const seal = (godCounter['正印'] || 0) + (godCounter['偏印'] || 0)
    const friend = (godCounter['比肩'] || 0) + (godCounter['劫财'] || 0)

    let score = 0
    const signals = []
    const isStrong = analysis.dayMasterStrength === '旺' || analysis.dayMasterStrength === '极旺'

    if (isStrong) {
      // 身旺：喜泄(食伤)、耗(财)、克(官杀)，忌生(印)、助(比劫)
      if (food >= 1.5 && wealth >= 0.5) {
        score += 30
        signals.push('身旺食伤生财，财源有源')
      }
      if (wealth >= 1.5) {
        score += 20
        signals.push('财星得用，求财有利')
      }
      if (officer >= 1) {
        score += 10
        signals.push('官杀制身，稳健可持')
      }
      if (friend >= 2 && wealth >= 0.5) {
        score -= 30
        signals.push('比劫夺财，防破财')
      }
      if (seal >= 2) {
        score -= 15
        signals.push('印旺助壅，宜静不宜动')
      }
    } else {
      // 身弱：喜生(印)、助(比劫)，忌泄(食伤)、耗(财)、克(官杀)
      if (seal >= 2) {
        score += 30
        signals.push('身弱印旺生身，贵人扶持')
      }
      if (friend >= 1.5) {
        score += 15
        signals.push('比劫帮身，有支撑')
      }
      if (food >= 1.5) {
        score -= 15
        signals.push('食伤泄气，身弱不胜')
      }
      if (wealth >= 1.5 || officer >= 1.5) {
        score -= 25
        signals.push('身弱不胜财官，宜守不宜攻')
      }
      if (seal < 1 && friend < 1) {
        score -= 20
        signals.push('身弱无助，孤立无援')
      }
    }

    // 调候用神到位加分
    if (analysis.toneGod) {
      const toneElem = analysis.toneGod
      let toneCount = 0
      for (const [k, v] of Object.entries(godCounter)) {
        if (tenGodElement(analysis.dayMaster, k) === toneElem) toneCount += v
      }
      if (toneCount >= 1) {
        score += 10
        signals.push(`调候用神(${toneElem})到位`)
      }
    }

    let action
    if (score >= 20) action = '买入'
    else if (score >= 5) action = '轻仓试探'
    else if (score >= -10) action = '观望'
    else if (score >= -25) action = '减仓'
    else action = '卖出'

    return {
      date: _fmtDate(dt),
      pillars: String(pillars),
      tenGodDistribution: godCounter,
      wealthScore: wealth,
      foodScore: food,
      officerScore: officer,
      sealScore: seal,
      friendScore: friend,
      signalScore: score,
      action,
      signals,
    }
  }
}
