/**
 * 个股取象分析器：行业/名称 → 十干类象 + 十神类象。
 *
 * 双层画像：
 * 1. 十干层（自然/行业属性）：甲~癸十个天干，带票数权重
 *    - 行业表命中：权重 4（未来接入行业字段时最强）
 *    - 名称关键词命中：权重 3（行业含义明确，可压过单字歧义）
 *    - 单字归属（CHAR_STEM）：权重 1
 *    - 只知五行的字：在该五行阳干/阴干上各投 0.5 票
 * 2. 十神层（行业性格）：仅行业/关键词可判定，普通单字不投十神票。
 *
 * 输出：{
 *   primaryStem, element, secondaryStems,
 *   stemVotes: {甲:票数...},
 *   gods: [{name, strength}],        // strength 已归一化，合计 1
 *   stemLabel, godLabel, godNames,
 * }
 */

import {
  STEMS, STEM_IMAGERY, GOD_IMAGERY,
  KEYWORD_IMAGERY, CHAR_STEM, INDUSTRY_IMAGERY,
} from './imageryData.js'
import { STEM_ELEMENT } from './elements.js'
import { CHAR_ELEMENT } from './stockElementData.js'

const KW_WEIGHT = 3
const CHAR_WEIGHT = 1
const INDUSTRY_WEIGHT = 4

function emptyVotes() {
  const v = {}
  for (const s of STEMS) v[s] = 0
  return v
}

/** 五行 → 阳干/阴干 */
function stemsOfElement(elem) {
  return STEMS.filter((s) => STEM_ELEMENT[s] === elem)
}

export class StockImageryAnalyzer {
  /**
   * 分析票名（+可选行业）的取象画像。
   * 无法识别任何字/词时返回 null（扫描时与旧版 combinedElement 返 undefined 同样处理）。
   */
  static analyze(name, industry = undefined) {
    const text = String(name || '')
    const stemVotes = emptyVotes()
    const godVotes = {}
    let totalCharVotes = 0
    let matchedChars = []

    const addStem = (stem, w) => { stemVotes[stem] += w }
    const addGod = (god, w) => { godVotes[god] = (godVotes[god] || 0) + w }

    // 1. 行业（如有）
    if (industry && INDUSTRY_IMAGERY[industry]) {
      const ii = INDUSTRY_IMAGERY[industry]
      for (const s of ii.stems || []) addStem(s, INDUSTRY_WEIGHT)
      for (const g of ii.gods || []) addGod(g, INDUSTRY_WEIGHT)
    }

    // 2. 名称关键词
    for (const [kw, ii] of Object.entries(KEYWORD_IMAGERY)) {
      if (text.includes(kw)) {
        for (const s of ii.stems || []) addStem(s, KW_WEIGHT)
        for (const g of ii.gods || []) addGod(g, KW_WEIGHT)
      }
    }

    // 3. 单字
    for (const ch of text) {
      const precise = CHAR_STEM[ch]
      if (precise) {
        addStem(precise, CHAR_WEIGHT)
        totalCharVotes += CHAR_WEIGHT
        matchedChars.push(ch)
        continue
      }
      const elem = CHAR_ELEMENT[ch]
      if (elem) {
        // 只知五行：阳干/阴干平分
        for (const s of stemsOfElement(elem)) addStem(s, CHAR_WEIGHT * 0.5)
        totalCharVotes += CHAR_WEIGHT
        matchedChars.push(ch)
      }
    }

    // 主天干
    let primaryStem
    let best = 0
    for (const s of STEMS) {
      if (stemVotes[s] > best) {
        best = stemVotes[s]
        primaryStem = s
      }
    }
    if (!primaryStem || best <= 0) return null

    // 次天干（票数 ≥ 主天干 25%）
    const secondaryStems = STEMS.filter(
      (s) => s !== primaryStem && stemVotes[s] >= best * 0.25 && stemVotes[s] > 0,
    )

    // 十神归一化
    const godTotal = Object.values(godVotes).reduce((a, b) => a + b, 0)
    const gods = godTotal > 0
      ? Object.entries(godVotes)
        .map(([name, v]) => ({ name, strength: Math.round((v / godTotal) * 100) / 100 }))
        .sort((a, b) => b.strength - a.strength)
      : []

    const primaryGod = gods.length ? gods[0].name : null
    const stemInfo = STEM_IMAGERY[primaryStem]

    return {
      name: text,
      industry: industry || null,
      primaryStem,
      element: stemInfo.elem,
      secondaryStems,
      stemVotes,
      totalCharVotes,
      matchedChars,
      gods,
      primaryGod,
      godNames: gods.map((g) => g.name),
      stemLabel: stemInfo.label,
      godLabel: primaryGod ? GOD_IMAGERY[primaryGod].label : null,
      stemNature: stemInfo.nature,
    }
  }

  /** 便捷：仅取主天干。 */
  static primaryStem(name, industry = undefined) {
    const img = this.analyze(name, industry)
    return img ? img.primaryStem : undefined
  }

  /** 便捷：仅取五行（与旧 StockElementAnalyzer.combinedElement 同位替换）。 */
  static combinedElement(name, industry = undefined) {
    const img = this.analyze(name, industry)
    return img ? img.element : undefined
  }

  /**
   * 名称对喜用天干的共振度 (0~1)：
   * 命中正选天干的字每字记 1，命中同五行另一干记 0.5。
   */
  static nameResonance(img, preferredStems, useElements = []) {
    if (!img || !img.totalCharVotes) return 0
    const pref = new Set(preferredStems.filter(Boolean))
    let score = 0
    for (const ch of img.name) {
      const stem = CHAR_STEM[ch]
      if (stem) {
        if (pref.has(stem)) score += 1
        else if (useElements.includes(STEM_ELEMENT[stem])) score += 0.5
      } else {
        const elem = CHAR_ELEMENT[ch]
        if (elem && useElements.includes(elem)) score += 0.5
      }
    }
    return Math.min(1, score / img.totalCharVotes)
  }
}
