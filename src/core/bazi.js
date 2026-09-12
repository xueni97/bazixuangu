// bazi.js - 四柱排盘引擎。
//
// 根据公历日期时间计算年柱、月柱、日柱、时柱。
// - 年柱：以立春为界
// - 月柱：以十二节为界（寅月起于立春）
// - 日柱：以零点为界，用儒略日计算
// - 时柱：以时辰为界（23点起为子时，属次日）
//
// 节气日期采用近似值（平均日期±1日），满足股票决策的精度需求。
// 移植自 sequoia_x/strategy/metaphysics/bazi.py

import {
  STEMS,
  BRANCHES,
  BRANCH_HIDDEN_STEMS,
  BRANCH_MAIN_QI,
  STEM_ELEMENT,
  element_of_stem,
  element_of_branch,
  ten_god,
} from "./elements.js";

// ── 节气近似日期（月-日） ─────────────────────────────────
// 十二节定义月支边界，采用常年平均日期
export const SOLAR_TERMS_MONTH_BOUNDARY = [
  // [month, day, branch]  -- 此日起进入该月支
  [1, 6, "丑"],   // 小寒
  [2, 4, "寅"],   // 立春
  [3, 6, "卯"],   // 惊蛰
  [4, 5, "辰"],   // 清明
  [5, 6, "巳"],   // 立夏
  [6, 6, "午"],   // 芒种
  [7, 7, "未"],   // 小暑
  [8, 8, "申"],   // 立秋
  [9, 8, "酉"],   // 白露
  [10, 8, "戌"],  // 寒露
  [11, 7, "亥"],  // 立冬
  [12, 7, "子"],  // 大雪
];

/** (aMonth, aDay) >= (bMonth, bDay) 的元组比较。 */
function dateGe(aMonth, aDay, bMonth, bDay) {
  return aMonth > bMonth || (aMonth === bMonth && aDay >= bDay);
}

/** (aMonth, aDay) < (bMonth, bDay) 的元组比较。 */
function dateLt(aMonth, aDay, bMonth, bDay) {
  return aMonth < bMonth || (aMonth === bMonth && aDay < bDay);
}

/** Python 风格的向下取整除法（与 Python // 一致，负数向负无穷取整）。 */
function floordiv(a, b) {
  return Math.floor(a / b);
}

/** Python 风格取模（结果符号与除数一致，恒非负）。 */
function pymod(a, n) {
  return ((a % n) + n) % n;
}

/** 根据公历月日确定月支。 */
export function _month_branch(month, day) {
  // for-else：若循环因 break 结束则 result 可能为未定义；
  // 这里默认 "子" 对应循环走完所有节气仍未 break 的情况
  let result = "子";
  for (const [m, d, branch] of SOLAR_TERMS_MONTH_BOUNDARY) {
    if (dateGe(month, day, m, d)) {
      result = branch;
    } else {
      break;
    }
  }
  // 1月6日前属于上一年的丑月（小寒前仍为子月）
  if (dateLt(month, day, 1, 6)) {
    return "子";
  }
  return result;
}

// ── 五虎遁：年干推月干 ──────────────────────────────────
// 甲己之年丙作首，乙庚之年戊为头，
// 丙辛必定寻庚起，丁壬壬位顺行流，
// 戊癸之年何方发，甲寅之上好追求。
export const TIGER_ESCAPE = {
  甲: "丙", 己: "丙",
  乙: "戊", 庚: "戊",
  丙: "庚", 辛: "庚",
  丁: "壬", 壬: "壬",
  戊: "甲", 癸: "甲",
};

/** 五虎遁求月干。 */
export function _month_stem(yearStem, monthBranch) {
  const startStem = TIGER_ESCAPE[yearStem];
  const startIdx = STEMS.indexOf(startStem);
  // 寅月为正月，月支索引：寅=2
  const branchIdx = BRANCHES.indexOf(monthBranch);
  const offset = pymod(branchIdx - 2, 12);
  return STEMS[pymod(startIdx + offset, 10)];
}

// ── 五鼠遁：日干推时干 ──────────────────────────────────
// 甲己还加甲，乙庚丙作初，
// 丙辛从戊起，丁壬庚子居，
// 戊癸何方发，壬子是真途。
export const RAT_ESCAPE = {
  甲: "甲", 己: "甲",
  乙: "丙", 庚: "丙",
  丙: "戊", 辛: "戊",
  丁: "庚", 壬: "庚",
  戊: "壬", 癸: "壬",
};

/** 根据小时确定时支。23点起为子时（次日）。 */
export function _hour_branch(hour, minute = 0) {
  if (hour === 23 || hour < 1) {
    return "子";
  }
  const idx = floordiv(hour + 1, 2);
  return BRANCHES[idx];
}

/** 五鼠遁求时干。 */
export function _hour_stem(dayStem, hourBranch) {
  const startStem = RAT_ESCAPE[dayStem];
  const startIdx = STEMS.indexOf(startStem);
  const branchIdx = BRANCHES.indexOf(hourBranch);
  return STEMS[pymod(startIdx + branchIdx, 10)];
}

// ── 日柱计算（儒略日） ──────────────────────────────────
/** 计算儒略日数。 */
export function _julian_day(year, month, day) {
  const a = floordiv(14 - month, 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + floordiv(153 * m + 2, 5) + 365 * y + floordiv(y, 4) - floordiv(y, 100) + floordiv(y, 400) - 32045;
}

/** 根据公历日期计算日柱。返回 [stem, branch]。 */
export function _day_pillar(year, month, day) {
  const jdn = _julian_day(year, month, day);
  const idx = pymod(jdn + 49, 60);
  const stem = STEMS[pymod(idx, 10)];
  const branch = BRANCHES[pymod(idx, 12)];
  return [stem, branch];
}

// ── 年柱计算（立春为界） ─────────────────────────────────
/** 根据公历日期计算年柱，以立春为界。返回 [stem, branch]。 */
export function _year_pillar(year, month, day) {
  // 立春前属上一年
  if (dateLt(month, day, 2, 4)) {
    year -= 1;
  }
  const stemIdx = pymod(year - 4, 10);
  const branchIdx = pymod(year - 4, 12);
  return [STEMS[stemIdx], BRANCHES[branchIdx]];
}

/** 单柱：天干 + 地支。 */
export class Pillar {
  constructor(stem, branch) {
    this.stem = stem;
    this.branch = branch;
  }

  get ganzhi() {
    return this.stem + this.branch;
  }

  get hidden_stems() {
    return BRANCH_HIDDEN_STEMS[this.branch];
  }

  get main_qi() {
    return BRANCH_MAIN_QI[this.branch];
  }

  toString() {
    return this.ganzhi;
  }
}

/** 四柱：年月日时。 */
export class FourPillars {
  constructor(year, month, day, hour) {
    this.year = year;
    this.month = month;
    this.day = day;
    this.hour = hour;
  }

  get day_master() {
    return this.day.stem;
  }

  /** 返回四柱列表 [年, 月, 日, 时]。 */
  pillars() {
    return [this.year, this.month, this.day, this.hour];
  }

  toString() {
    return `${this.year} ${this.month} ${this.day} ${this.hour}`;
  }
}

/** 四柱排盘引擎。 */
export class BaziEngine {
  /** 根据 Date 计算四柱。 */
  static from_datetime(dt) {
    let year = dt.getFullYear();
    let month = dt.getMonth() + 1;  // JS getMonth() 0-based，转换为 1-based
    let day = dt.getDate();
    const hour = dt.getHours();
    const minute = dt.getMinutes();

    // 处理夜子时（23:00-23:59 属于次日）
    if (hour >= 23) {
      const dtNext = new Date(dt);
      dtNext.setDate(dtNext.getDate() + 1);
      year = dtNext.getFullYear();
      month = dtNext.getMonth() + 1;
      day = dtNext.getDate();
    }

    const [yStem, yBranch] = _year_pillar(year, month, day);
    const mBranch = _month_branch(month, day);
    const mStem = _month_stem(yStem, mBranch);
    const [dStem, dBranch] = _day_pillar(year, month, day);
    const hBranch = _hour_branch(hour, minute);
    const hStem = _hour_stem(dStem, hBranch);

    return new FourPillars(
      new Pillar(yStem, yBranch),
      new Pillar(mStem, mBranch),
      new Pillar(dStem, dBranch),
      new Pillar(hStem, hBranch),
    );
  }

  /** 根据年月日时（整数）计算四柱。 */
  static from_ymd(year, month, day, hour = 12) {
    return BaziEngine.from_datetime(new Date(year, month - 1, day, hour, 0));
  }

  /** 计算十神。 */
  static ten_god_of(dayStem, otherStem) {
    return ten_god(dayStem, otherStem);
  }
}
