// model.js - 渊海子平决策模型
//
// 核心逻辑（参考《渊海子平》《子平真诠》）：
// 1. 以当日四柱为"市场命盘"，月令为提纲
// 2. 判断五行旺衰：得令、得地、得势
// 3. 定用神（扶抑 + 调候）
// 4. 评分模型 + 周/月/日方向与买点
//
// 移植自 sequoia_x/strategy/metaphysics/model.py
// 所有返回对象的属性名使用 camelCase

import {
  STEMS,
  BRANCHES,
  STEM_ELEMENT,
  BRANCH_ELEMENT,
  BRANCH_HIDDEN_STEMS,
  BRANCH_MAIN_QI,
  GENERATE,
  RESTRAIN,
  element_strength_in_month,
  STRENGTH_SCORE,
  ten_god,
  ten_god_element,
} from "./elements.js";
import { BaziEngine } from "./bazi.js";
import { StockElementAnalyzer } from "./stock_element.js";

const GENERATED_BY = {};
for (const [k, v] of Object.entries(GENERATE)) GENERATED_BY[v] = k;
const RESTRAINED_BY = {};
for (const [k, v] of Object.entries(RESTRAIN)) RESTRAINED_BY[v] = k;

const ELEMENTS = ["木", "火", "土", "金", "水"];

function addDays(dt, n) {
  const d = new Date(dt);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatWeekday(dt) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[dt.getDay()];
}

function getMonday(dt) {
  const d = new Date(dt);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

export class YuanhaiDecisionModel {
  static ELEMENTS = ELEMENTS;

  static analyze(pillars) {
    const dayMaster = pillars.day.stem;
    const dayElem = STEM_ELEMENT[dayMaster];
    const monthBranch = pillars.month.branch;

    // 1. 统计五行得分
    const elementScores = {};
    const elementsStrength = {};
    for (const elem of ELEMENTS) {
      const strength = element_strength_in_month(monthBranch, elem);
      elementsStrength[elem] = strength;
      elementScores[elem] = (elementScores[elem] || 0) + (STRENGTH_SCORE[strength] || 0);
    }

    // 天干计分
    for (const p of [pillars.year, pillars.month, pillars.day, pillars.hour]) {
      const e = STEM_ELEMENT[p.stem];
      elementScores[e] = (elementScores[e] || 0) + 1.0;
    }

    // 地支藏干计分
    for (const p of [pillars.year, pillars.month, pillars.day, pillars.hour]) {
      const hidden = BRANCH_HIDDEN_STEMS[p.branch] || [];
      for (let i = 0; i < hidden.length; i++) {
        const e = STEM_ELEMENT[hidden[i]];
        const weight = i === 0 ? 1.0 : i === 1 ? 0.5 : i === 2 ? 0.3 : 0.2;
        elementScores[e] = (elementScores[e] || 0) + weight;
      }
    }

    // 2. 判断日主旺衰
    const dmStrengthInMonth = elementsStrength[dayElem];
    const deMingling = dmStrengthInMonth === "旺" || dmStrengthInMonth === "相";

    let deDedi = 0;
    for (const p of [pillars.year, pillars.month, pillars.day, pillars.hour]) {
      if (BRANCH_ELEMENT[p.branch] === dayElem) deDedi += 1;
      else {
        for (const h of (BRANCH_HIDDEN_STEMS[p.branch] || [])) {
          if (STEM_ELEMENT[h] === dayElem) deDedi += 0.3;
        }
      }
    }
    const deDediBool = deDedi >= 1.0;

    let deDeshi = 0;
    for (const p of [pillars.year, pillars.month, pillars.hour]) {
      if (STEM_ELEMENT[p.stem] === dayElem) deDeshi += 1;
    }
    const deDeshiBool = deDeshi >= 1;

    let dayMasterStrength;
    if (deMingling && deDediBool && deDeshiBool) dayMasterStrength = "极旺";
    else if (deMingling && (deDediBool || deDeshiBool)) dayMasterStrength = "旺";
    else dayMasterStrength = "弱";

    // 3. 定用神
    let useGods = [];
    let avoidGods = [];

    if (dayMasterStrength === "旺" || dayMasterStrength === "极旺") {
      for (const god of ["正官", "七杀", "食神", "伤官", "正财", "偏财"]) {
        const ge = ten_god_element(dayMaster, god);
        if (ge && !useGods.includes(ge)) useGods.push(ge);
      }
      for (const god of ["正印", "偏印", "比肩", "劫财"]) {
        const ge = ten_god_element(dayMaster, god);
        if (ge && !avoidGods.includes(ge)) avoidGods.push(ge);
      }
    } else {
      for (const god of ["正印", "偏印", "比肩", "劫财"]) {
        const ge = ten_god_element(dayMaster, god);
        if (ge && !useGods.includes(ge)) useGods.push(ge);
      }
      for (const god of ["正官", "七杀", "食神", "伤官", "正财", "偏财"]) {
        const ge = ten_god_element(dayMaster, god);
        if (ge && !avoidGods.includes(ge)) avoidGods.push(ge);
      }
    }

    // 4. 调候用神
    let toneGod = null;
    if (["亥", "子", "丑"].includes(monthBranch)) {
      toneGod = "火";
      if (!useGods.includes("火")) useGods.unshift("火");
    } else if (["巳", "午", "未"].includes(monthBranch)) {
      toneGod = "水";
      if (!useGods.includes("水")) useGods.unshift("水");
    } else if (["寅", "卯", "辰"].includes(monthBranch)) {
      toneGod = "金";
      if (!useGods.includes("金")) useGods.unshift("金");
    } else if (["申", "酉", "戌"].includes(monthBranch)) {
      toneGod = "火";
      if (!useGods.includes("火")) useGods.unshift("火");
    }

    // 5. 各柱十神
    const tenGodsOfPillars = {};
    for (const [name, p] of [["年", pillars.year], ["月", pillars.month], ["日", pillars.day], ["时", pillars.hour]]) {
      tenGodsOfPillars[name] = ten_god(dayMaster, p.stem);
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
    };
  }

  static stock_score(stockElement, analysis, stockName = null) {
    if (!stockElement) return { score: 0, level: "中性", reason: "五行属性不明" };

    const useGods = analysis.useGods;
    const avoidGods = analysis.avoidGods;
    const toneGod = analysis.toneGod;

    let score = 0;
    const reasons = [];

    if (useGods.includes(stockElement)) {
      if (stockElement === toneGod) {
        score += 40;
        reasons.push(`${stockElement}为调候用神`);
      } else {
        const rank = useGods.indexOf(stockElement);
        score += Math.max(30 - rank * 8, 12);
        reasons.push(`${stockElement}为扶抑用神(第${rank + 1}位)`);
      }
    } else if (avoidGods.includes(stockElement)) {
      const rank = avoidGods.indexOf(stockElement);
      score -= Math.max(30 - rank * 8, 12);
      reasons.push(`${stockElement}为忌神(第${rank + 1}位)`);
    } else {
      if (GENERATE[stockElement] && useGods.includes(GENERATE[stockElement])) {
        score += 12;
        reasons.push(`${stockElement}生用神(${GENERATE[stockElement]})`);
      } else if (RESTRAIN[stockElement] && useGods.includes(RESTRAIN[stockElement])) {
        score -= 18;
        reasons.push(`${stockElement}克用神(${RESTRAIN[stockElement]})`);
      } else if (GENERATED_BY[stockElement] && useGods.includes(GENERATED_BY[stockElement])) {
        score -= 8;
        reasons.push(`${stockElement}为用神所生`);
      } else {
        reasons.push(`${stockElement}为闲神`);
      }
    }

    // 名称字符级匹配
    if (stockName) {
      for (const target of useGods.slice(0, 2)) {
        const charScore = StockElementAnalyzer.score_by_element(stockName, target);
        if (charScore > 0) {
          const bonus = Math.floor(charScore * 30);
          score += bonus;
          if (bonus > 0) reasons.push(`名称含${target}气(${charScore.toFixed(2)})`);
          break;
        }
      }
    }

    // 月令旺衰
    const strength = analysis.elementsStrength[stockElement] || "休";
    if (strength === "旺") { score += 8; reasons.push("得月令旺气"); }
    else if (strength === "相") { score += 4; }
    else if (strength === "死") { score -= 8; reasons.push("月令处死地"); }

    score = Math.max(-100, Math.min(100, score));

    let level;
    if (score >= 45) level = "强烈推荐";
    else if (score >= 15) level = "推荐";
    else if (score >= -10) level = "中性";
    else if (score >= -35) level = "谨慎";
    else level = "回避";

    return { score, level, reason: reasons.join("；") };
  }

  static daily_direction(dt) {
    const pillars = BaziEngine.from_datetime(dt);
    const analysis = YuanhaiDecisionModel.analyze(pillars);
    return {
      date: formatDate(dt),
      weekday: formatWeekday(dt),
      pillars: pillars.toString(),
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
    };
  }

  static weekly_direction(dt) {
    const monday = getMonday(dt);
    const pillars = BaziEngine.from_datetime(monday);
    const analysis = YuanhaiDecisionModel.analyze(pillars);

    const weekDays = [];
    for (let i = 0; i < 5; i++) {
      const day = addDays(monday, i);
      const dp = BaziEngine.from_datetime(day);
      const da = YuanhaiDecisionModel.analyze(dp);
      weekDays.push({
        date: formatDate(day),
        weekday: formatWeekday(day),
        pillar: dp.day.stem + dp.day.branch,
        useGods: da.useGods.slice(0, 2),
        avoidGods: da.avoidGods.slice(0, 2),
        dayMasterStrength: da.dayMasterStrength,
      });
    }

    const useGodCounter = {};
    for (const wd of weekDays) {
      for (const g of wd.useGods) useGodCounter[g] = (useGodCounter[g] || 0) + 1;
    }
    const topUse = Object.entries(useGodCounter).sort((a, b) => b[1] - a[1]);

    const bestDay = weekDays.reduce((best, d) =>
      d.useGods.length > best.useGods.length ? d : best, weekDays[0]);

    return {
      weekStart: formatDate(monday),
      weekPillars: pillars.toString(),
      dayMaster: analysis.dayMaster,
      weekUseGods: topUse.slice(0, 3).map(([g]) => g),
      weekAvoidGods: analysis.avoidGods.slice(0, 3),
      dailyBreakdown: weekDays,
      bestDay,
    };
  }

  static monthly_direction(dt) {
    const firstDay = new Date(dt.getFullYear(), dt.getMonth(), 1);
    const pillars = BaziEngine.from_datetime(firstDay);
    const analysis = YuanhaiDecisionModel.analyze(pillars);
    const monthPillar = pillars.month;
    const monthStemElem = STEM_ELEMENT[monthPillar.stem];
    const monthBranchElem = BRANCH_ELEMENT[monthPillar.branch];

    const weeklyUseCounter = {};
    const weeks = [];
    for (let w = 0; w < 5; w++) {
      const ws = addDays(firstDay, w * 7);
      if (ws.getMonth() !== dt.getMonth()) break;
      const wp = BaziEngine.from_datetime(ws);
      const wa = YuanhaiDecisionModel.analyze(wp);
      for (const g of wa.useGods.slice(0, 2)) weeklyUseCounter[g] = (weeklyUseCounter[g] || 0) + 1;
      weeks.push({
        weekStart: formatDate(ws),
        useGods: wa.useGods.slice(0, 2),
        avoidGods: wa.avoidGods.slice(0, 2),
      });
    }

    const topMonthUse = Object.entries(weeklyUseCounter).sort((a, b) => b[1] - a[1]);
    const topElems = topMonthUse.slice(0, 3).map(([g]) => g);

    return {
      yearMonth: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`,
      monthPillar: monthPillar.stem + monthPillar.branch,
      monthStemElement: monthStemElem,
      monthBranchElement: monthBranchElem,
      dayMaster: analysis.dayMaster,
      dayMasterStrength: analysis.dayMasterStrength,
      monthUseGods: topElems,
      monthAvoidGods: analysis.avoidGods.slice(0, 3),
      toneGod: analysis.toneGod,
      weeklyBreakdown: weeks,
      recommendedSectors: YuanhaiDecisionModel._element_to_sectors(topElems),
    };
  }

  static _element_to_sectors(elements) {
    const sectorMap = {
      "木": ["农林牧渔", "医药生物", "纺织服饰", "教育", "造纸印刷"],
      "火": ["电子", "电力设备", "国防军工", "计算机", "传媒", "通信", "石油石化", "煤炭"],
      "土": ["房地产", "建筑装饰", "建筑材料", "钢铁", "有色金属", "基础化工"],
      "金": ["银行", "非银金融", "汽车", "机械设备", "家用电器", "食品饮料"],
      "水": ["交通运输", "商贸零售", "公用事业", "环保", "社会服务"],
    };
    const result = {};
    for (const e of elements) result[e] = sectorMap[e] || [];
    return result;
  }

  static buy_point_signal(dt) {
    const pillars = BaziEngine.from_datetime(dt);
    const analysis = YuanhaiDecisionModel.analyze(pillars);
    const dm = analysis.dayMaster;

    const godCounter = {};
    for (const [name, p] of [["年", pillars.year], ["月", pillars.month], ["日", pillars.day], ["时", pillars.hour]]) {
      const god = ten_god(dm, p.stem);
      godCounter[god] = (godCounter[god] || 0) + 1;
      for (const h of (BRANCH_HIDDEN_STEMS[p.branch] || [])) {
        const g = ten_god(dm, h);
        godCounter[g] = (godCounter[g] || 0) + 0.5;
      }
    }

    const wealth = (godCounter["正财"] || 0) + (godCounter["偏财"] || 0);
    const food = (godCounter["食神"] || 0) + (godCounter["伤官"] || 0);
    const officer = (godCounter["正官"] || 0) + (godCounter["七杀"] || 0);
    const seal = (godCounter["正印"] || 0) + (godCounter["偏印"] || 0);
    const friend = (godCounter["比肩"] || 0) + (godCounter["劫财"] || 0);

    let score = 0;
    const signals = [];
    const isStrong = analysis.dayMasterStrength === "旺" || analysis.dayMasterStrength === "极旺";

    if (isStrong) {
      if (food >= 1.5 && wealth >= 0.5) { score += 30; signals.push("身旺食伤生财，财源有源"); }
      if (wealth >= 1.5) { score += 20; signals.push("财星得用，求财有利"); }
      if (officer >= 1) { score += 10; signals.push("官杀制身，稳健可持"); }
      if (friend >= 2 && wealth >= 0.5) { score -= 30; signals.push("比劫夺财，防破财"); }
      if (seal >= 2) { score -= 15; signals.push("印旺助壅，宜静不宜动"); }
    } else {
      if (seal >= 2) { score += 30; signals.push("身弱印旺生身，贵人扶持"); }
      if (friend >= 1.5) { score += 15; signals.push("比劫帮身，有支撑"); }
      if (food >= 1.5) { score -= 15; signals.push("食伤泄气，身弱不胜"); }
      if (wealth >= 1.5 || officer >= 1.5) { score -= 25; signals.push("身弱不胜财官，宜守不宜攻"); }
      if (seal < 1 && friend < 1) { score -= 20; signals.push("身弱无助，孤立无援"); }
    }

    if (analysis.toneGod) {
      let toneCount = 0;
      for (const [k, v] of Object.entries(godCounter)) {
        if (ten_god_element(analysis.dayMaster, k) === analysis.toneGod) toneCount += v;
      }
      if (toneCount >= 1) { score += 10; signals.push(`调候用神(${analysis.toneGod})到位`); }
    }

    let action;
    if (score >= 20) action = "买入";
    else if (score >= 5) action = "轻仓试探";
    else if (score >= -10) action = "观望";
    else if (score >= -25) action = "减仓";
    else action = "卖出";

    return {
      date: formatDate(dt),
      pillars: pillars.toString(),
      tenGodDistribution: godCounter,
      wealthScore: wealth,
      foodScore: food,
      officerScore: officer,
      sealScore: seal,
      friendScore: friend,
      signalScore: score,
      action,
      signals,
    };
  }
}
