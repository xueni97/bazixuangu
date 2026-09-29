/**
 * 黄历择日模块：建除十二值星 + 四离四绝 + 岁破月破。
 *
 * 命理引擎的 buyPointSignal 只看四柱十神能量，不看择日学的凶神。
 * 黄历凶日（四离/岁破/月破/值星"破"等）不宜开市交易，
 * 即使命理信号"买入"也应降级为"观望"。
 *
 * 2026-09-22 = 秋分前一日 = 四离日，2026-09-23 = 岁破/秋分，
 * 解释了为何三周期命理都"买入"但实际大跌：黄历凶日未过滤。
 */

import { BaziEngine } from './bazi.js'

const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

// 建除十二值星：与月建地支的偏移决定当日值星
const TWELVE_OFFICERS = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭']

// 凶神值星（不宜开市/交易）
const INAUSPICIOUS_OFFICERS = new Set(['破', '危', '闭', '满'])

// 二十四节气近似日期（月-日）——四离四绝计算用
// 二分二至：春分/夏至/秋分/冬至（四离的前一节气）
const FOUR_SEPARATION_TERMS = [
  { name: '春分', md: [3, 21] },
  { name: '夏至', md: [6, 21] },
  { name: '秋分', md: [9, 23] },
  { name: '冬至', md: [12, 22] },
]

// 四立：立春/立夏/立秋/立冬（四绝的前一节气）
const FOUR_EXTINCTION_TERMS = [
  { name: '立春', md: [2, 4] },
  { name: '立夏', md: [5, 5] },
  { name: '立秋', md: [8, 7] },
  { name: '立冬', md: [11, 7] },
]

function pad2(n) { return String(n).padStart(2, '0') }
function fmtMd(d) { return `${d.getMonth() + 1}-${d.getDate()}` }

/**
 * 判断某日是否四离日（二分二至前一日，季节交替分離之时，凶）。
 */
function isFourSeparation(d) {
  const md = fmtMd(d)
  for (const term of FOUR_SEPARATION_TERMS) {
    const [m, day] = term.md
    const termDate = new Date(d.getFullYear(), m - 1, day)
    const before = new Date(termDate)
    before.setDate(before.getDate() - 1)
    if (d.getMonth() === before.getMonth() && d.getDate() === before.getDate()) {
      return { hit: true, name: `四离（${term.name}前一日）` }
    }
  }
  return { hit: false, name: null }
}

/**
 * 判断某日是否四绝日（四立前一日，气绝之时，凶）。
 */
function isFourExtinction(d) {
  const md = fmtMd(d)
  for (const term of FOUR_EXTINCTION_TERMS) {
    const [m, day] = term.md
    const termDate = new Date(d.getFullYear(), m - 1, day)
    const before = new Date(termDate)
    before.setDate(before.getDate() - 1)
    if (d.getMonth() === before.getMonth() && d.getDate() === before.getDate()) {
      return { hit: true, name: `四绝（${term.name}前一日）` }
    }
  }
  return { hit: false, name: null }
}

/**
 * 建除十二值星：日支相对月建的偏移。
 * 月建=当月地支，日支序号-月建序号（mod 12）→ 12值星。
 */
function getOfficer(monthBranch, dayBranch) {
  const mi = BRANCHES.indexOf(monthBranch)
  const di = BRANCHES.indexOf(dayBranch)
  if (mi < 0 || di < 0) return null
  const offset = (di - mi + 12) % 12
  return TWELVE_OFFICERS[offset]
}

/**
 * 岁破：日支冲年支（太岁之冲，大凶）。
 * 子午冲、丑未冲、寅申冲、卯酉冲、辰戌冲、巳亥冲。
 */
function isYearBreak(yearBranch, dayBranch) {
  const clash = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' }
  return dayBranch === clash[yearBranch]
}

/**
 * 月破：日支冲月支（月令之冲，凶）。
 */
function isMonthBreak(monthBranch, dayBranch) {
  const clash = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' }
  return dayBranch === clash[monthBranch]
}

/**
 * 计算某日的黄历择日信息。
 * @param {Date} dt
 * @returns {object} { officer, fourSeparation, fourExtinction, yearBreak, monthBreak, inauspicious, reasons }
 */
export function getAlmanac(dt) {
  const pillars = BaziEngine.fromDatetime(dt)
  const yearBranch = pillars.year.branch
  const monthBranch = pillars.month.branch
  const dayBranch = pillars.day.branch

  const officer = getOfficer(monthBranch, dayBranch)
  const sep = isFourSeparation(dt)
  const ext = isFourExtinction(dt)
  const yb = isYearBreak(yearBranch, dayBranch)
  const mb = isMonthBreak(monthBranch, dayBranch)

  const reasons = []
  if (sep.hit) reasons.push(sep.name)
  if (ext.hit) reasons.push(ext.name)
  if (yb) reasons.push('岁破（日冲太岁）')
  if (mb) reasons.push('月破（日冲月令）')
  if (officer && INAUSPICIOUS_OFFICERS.has(officer)) reasons.push(`值星「${officer}」`)

  return {
    officer,
    fourSeparation: sep.hit,
    fourExtinction: ext.hit,
    yearBreak: yb,
    monthBreak: mb,
    inauspicious: reasons.length > 0,
    reasons,
    pillars: `${pillars.year.ganzhi} ${pillars.month.ganzhi} ${pillars.day.ganzhi}`,
  }
}

/**
 * 黄历凶日是否压制买入信号。
 * 四离/四绝/岁破/月破/凶值星 → 强制降级为观望，不入池。
 */
export function isAlmanacInauspicious(dt) {
  return getAlmanac(dt).inauspicious
}
