// index.js - 渊海子平命理选股模型 barrel file。
//
// 统一导出四柱排盘、五行基础数据、股票五行分析、渊海子平决策模型。
// 移植自 sequoia_x/strategy/metaphysics/__init__.py

// ── 基础五行数据 ──
export {
  STEMS,
  BRANCHES,
  STEM_ELEMENT,
  STEM_YINYANG,
  BRANCH_ELEMENT,
  ELEMENT_CSS_MAP,
  BRANCH_HIDDEN_STEMS,
  BRANCH_MAIN_QI,
  GENERATE,
  RESTRAIN,
  GENERATED_BY,
  RESTRAINED_BY,
  TEN_GOD_ELEMENT,
  TEN_GODS,
  SEASON_ELEMENT,
  STRENGTH_SCORE,
  GANZHI_60,
  GANZHI_INDEX,
  element_of_stem,
  element_of_branch,
  is_same_element,
  generates,
  restrains,
  ten_god,
  ten_god_element,
  element_strength_in_month,
  ganzhi_index,
  index_to_ganzhi,
} from "./elements.js";

// ── 四柱排盘引擎 ──
export {
  SOLAR_TERMS_MONTH_BOUNDARY,
  TIGER_ESCAPE,
  RAT_ESCAPE,
  _month_branch,
  _month_stem,
  _hour_branch,
  _hour_stem,
  _julian_day,
  _day_pillar,
  _year_pillar,
  Pillar,
  FourPillars,
  BaziEngine,
} from "./bazi.js";

// ── 股票五行分析 ──
export {
  CHAR_ELEMENT,
  _OVERRIDES,
  INDUSTRY_ELEMENT,
  NAME_KEYWORD_ELEMENT,
  StockElementAnalyzer,
} from "./stock_element.js";

// ── 渊海子平决策模型 ──
export {
  YuanhaiDecisionModel,
} from "./model.js";
