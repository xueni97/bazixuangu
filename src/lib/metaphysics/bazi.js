/**
 * 四柱排盘引擎。
 *
 * 由 sequoia_x/strategy/metaphysics/bazi.py 忠实翻译。
 * 根据公历日期时间计算年柱、月柱、日柱、时柱。
 * - 年柱：以立春为界
 * - 月柱：以十二节为界（寅月起于立春）
 * - 日柱：以零点为界，用儒略日计算
 * - 时柱：以时辰为界（23点起为子时，属次日）
 *
 * 节气日期采用近似值（平均日期±1日），满足股票决策的精度需求。
 */

import {
  STEMS, BRANCHES, BRANCH_HIDDEN_STEMS, BRANCH_MAIN_QI,
  STEM_ELEMENT, tenGod,
} from './elements.js'

// ── 节气近似日期（月-日） ─────────────────────────────────
// 十二节定义月支边界，采用常年平均日期
const SOLAR_TERMS_MONTH_BOUNDARY = [
  [1, 6, '丑'],    // 小寒
  [2, 4, '寅'],    // 立春
  [3, 6, '卯'],    // 惊蛰
  [4, 5, '辰'],    // 清明
  [5, 6, '巳'],    // 立夏
  [6, 6, '午'],    // 芒种
  [7, 7, '未'],    // 小暑
  [8, 8, '申'],    // 立秋
  [9, 8, '酉'],    // 白露
  [10, 8, '戌'],   // 寒露
  [11, 7, '亥'],   // 立冬
  [12, 7, '子'],   // 大雪
]

function _monthBranch(month, day) {
  /** 根据公历月日确定月支。 */
  const cur = month * 100 + day
  let result = '子'
  let broke = false
  for (const [m, d, branch] of SOLAR_TERMS_MONTH_BOUNDARY) {
    if (cur >= m * 100 + d) {
      result = branch
    } else {
      broke = true
      break
    }
  }
  if (!broke) result = '子'
  // 1月6日前属于上一年的丑月（小寒前仍为子月）
  if (cur < 1 * 100 + 6) return '子'
  return result
}

// ── 五虎遁：年干推月干 ──────────────────────────────────
// 甲己之年丙作首，乙庚之年戊为头，
// 丙辛必定寻庚起，丁壬壬位顺行流，
// 戊癸之年何方发，甲寅之上好追求。
const TIGER_ESCAPE = {
  甲: '丙', 己: '丙',
  乙: '戊', 庚: '戊',
  丙: '庚', 辛: '庚',
  丁: '壬', 壬: '壬',
  戊: '甲', 癸: '甲',
}

function _monthStem(yearStem, monthBranch) {
  /** 五虎遁求月干。 */
  const startStem = TIGER_ESCAPE[yearStem]
  const startIdx = STEMS.indexOf(startStem)
  // 寅月为正月，月支索引：寅=2
  const branchIdx = BRANCHES.indexOf(monthBranch)
  const offset = (((branchIdx - 2) % 12) + 12) % 12
  return STEMS[((startIdx + offset) % 10 + 10) % 10]
}

// ── 五鼠遁：日干推时干 ──────────────────────────────────
// 甲己还加甲，乙庚丙作初，
// 丙辛从戊起，丁壬庚子居，
// 戊癸何方发，壬子是真途。
const RAT_ESCAPE = {
  甲: '甲', 己: '甲',
  乙: '丙', 庚: '丙',
  丙: '戊', 辛: '戊',
  丁: '庚', 壬: '庚',
  戊: '壬', 癸: '壬',
}

function _hourBranch(hour, minute = 0) {
  /** 根据小时确定时支。23点起为子时（次日）。 */
  if (hour === 23 || hour < 1) return '子'
  const idx = Math.floor((hour + 1) / 2)
  return BRANCHES[idx]
}

function _hourStem(dayStem, hourBranch) {
  /** 五鼠遁求时干。 */
  const startStem = RAT_ESCAPE[dayStem]
  const startIdx = STEMS.indexOf(startStem)
  const branchIdx = BRANCHES.indexOf(hourBranch)
  return STEMS[((startIdx + branchIdx) % 10 + 10) % 10]
}

// ── 日柱计算（儒略日） ──────────────────────────────────
function _julianDay(year, month, day) {
  /** 计算儒略日数。 */
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
}

function _dayPillar(year, month, day) {
  /** 根据公历日期计算日柱。 */
  const jdn = _julianDay(year, month, day)
  const idx = (((jdn + 49) % 60) + 60) % 60
  return [STEMS[idx % 10], BRANCHES[idx % 12]]
}

// ── 年柱计算（立春为界） ─────────────────────────────────
function _yearPillar(year, month, day) {
  /** 根据公历日期计算年柱，以立春为界。 */
  if (month * 100 + day < 2 * 100 + 4) year -= 1 // 立春前属上一年
  const stemIdx = (((year - 4) % 10) + 10) % 10
  const branchIdx = (((year - 4) % 12) + 12) % 12
  return [STEMS[stemIdx], BRANCHES[branchIdx]]
}

// ── 数据类 ──────────────────────────────────────────────
export class Pillar {
  /** 单柱：天干 + 地支。 */
  constructor(stem, branch) {
    this.stem = stem
    this.branch = branch
  }
  get ganzhi() { return this.stem + this.branch }
  get hiddenStems() { return BRANCH_HIDDEN_STEMS[this.branch] }
  get mainQi() { return BRANCH_MAIN_QI[this.branch] }
  toString() { return this.ganzhi }
}

export class FourPillars {
  /** 四柱：年月日时。 */
  constructor(year, month, day, hour) {
    this.year = year
    this.month = month
    this.day = day
    this.hour = hour
  }
  get dayMaster() { return this.day.stem }
  pillars() { return [this.year, this.month, this.day, this.hour] }
  toString() { return `${this.year} ${this.month} ${this.day} ${this.hour}` }
}

export class BaziEngine {
  /** 四柱排盘引擎。 */
  static fromDatetime(dt) {
    /** 根据 Date 对象计算四柱（month 为 0-based，内部转 1-based）。 */
    let year = dt.getFullYear()
    let month = dt.getMonth() + 1
    let day = dt.getDate()
    const hour = dt.getHours()
    const minute = dt.getMinutes()

    // 处理夜子时（23:00-23:59 属于次日）
    if (hour >= 23) {
      const next = new Date(dt.getTime() + 24 * 3600 * 1000)
      year = next.getFullYear()
      month = next.getMonth() + 1
      day = next.getDate()
    }

    const [yStem, yBranch] = _yearPillar(year, month, day)
    const mBranch = _monthBranch(month, day)
    const mStem = _monthStem(yStem, mBranch)
    const [dStem, dBranch] = _dayPillar(year, month, day)
    const hBranch = _hourBranch(hour, minute)
    const hStem = _hourStem(dStem, hBranch)

    return new FourPillars(
      new Pillar(yStem, yBranch),
      new Pillar(mStem, mBranch),
      new Pillar(dStem, dBranch),
      new Pillar(hStem, hBranch),
    )
  }

  static fromYmd(year, month, day, hour = 12) {
    /** 根据年月日时（整数，month 1-based）计算四柱。 */
    return BaziEngine.fromDatetime(new Date(year, month - 1, day, hour))
  }

  static tenGodOf(dayStem, otherStem) {
    /** 计算十神。 */
    return tenGod(dayStem, otherStem)
  }
}
