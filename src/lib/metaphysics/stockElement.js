/**
 * 股票名称与行业的五行属性分析。
 *
 * 由 sequoia_x/strategy/metaphysics/stock_element.py 忠实翻译。
 * 基于《渊海子平》五行取象，将汉字按部首、字义归入木火土金水，
 * 并建立 A 股常见行业的五行映射。
 *
 * 数据表（CHAR_ELEMENT/INDUSTRY_ELEMENT/NAME_KEYWORD_ELEMENT）由
 * scripts/generate_stock_data.py 从 Python 源自动导出，避免汉字转录错误。
 */

import { GENERATE, RESTRAIN, GENERATED_BY, RESTRAINED_BY } from './elements.js'
import {
  CHAR_ELEMENT,
  INDUSTRY_ELEMENT,
  NAME_KEYWORD_ELEMENT,
} from './stockElementData.js'

export class StockElementAnalyzer {
  /** 股票名称五行分析器。 */

  static charElement(ch) {
    /** 单个汉字的五行属性。 */
    return CHAR_ELEMENT[ch]
  }

  static nameElements(name) {
    /** 分析股票名称中每个字符的五行。 */
    const elements = []
    for (const ch of name) {
      const e = this.charElement(ch)
      if (e) elements.push(e)
    }
    return elements
  }

  static dominantElement(name) {
    /** 股票名称的主五行（出现次数最多的）。 */
    const elements = this.nameElements(name)
    if (!elements.length) return undefined
    const counter = {}
    for (const e of elements) counter[e] = (counter[e] || 0) + 1
    // 取出现次数最多者（与 Python Counter.most_common(1) 一致，遇到并列取最先出现）
    let best = elements[0]
    let bestN = -1
    for (const e of elements) {
      if (counter[e] > bestN) {
        bestN = counter[e]
        best = e
      }
    }
    return best
  }

  static elementProfile(name) {
    /** 股票名称的五行分布。 */
    const elements = this.nameElements(name)
    const profile = {}
    for (const e of elements) profile[e] = (profile[e] || 0) + 1
    return profile
  }

  static scoreByElement(name, targetElement) {
    /**
     * 计算股票名称对某目标五行的匹配得分 (0~1)。
     * - 名称中目标五行字符占比越高，得分越高
     * - 名称中"生目标"五行的字符也加分（通关）
     * - 名称中"克目标"五行的字符减分
     */
    const elements = this.nameElements(name)
    if (!elements.length) return 0.0

    const total = elements.length
    const targetGenerates = GENERATE[targetElement] // 我生
    const targetGeneratedBy = GENERATED_BY[targetElement] // 生我
    const targetRestrains = RESTRAIN[targetElement] // 我克
    const targetRestrainedBy = RESTRAINED_BY[targetElement] // 克我

    let score = 0.0
    for (const e of elements) {
      if (e === targetElement) {
        score += 1.0 // 同气
      } else if (e === targetGeneratedBy) {
        score += 0.8 // 生我者（印）
      } else if (e === targetGenerates) {
        score += 0.3 // 我生者（食伤，泄气但通关）
      } else if (e === targetRestrainedBy) {
        score -= 0.5 // 克我者（官杀）
      } else if (e === targetRestrains) {
        score -= 0.2 // 我克者（财，耗气）
      }
    }
    return Math.round((score / total) * 1000) / 1000
  }

  static industryElement(industry) {
    /** 根据行业名称判断五行。 */
    return INDUSTRY_ELEMENT[industry]
  }

  static keywordElement(name) {
    /** 根据股票名称中的关键词判断五行。 */
    for (const [keyword, element] of Object.entries(NAME_KEYWORD_ELEMENT)) {
      if (name.includes(keyword)) return element
    }
    return undefined
  }

  static combinedElement(name, industry = undefined) {
    /**
     * 综合判断股票五行属性：
     * 1. 优先行业五行
     * 2. 其次名称关键词
     * 3. 最后名称字符统计
     */
    if (industry) {
      const ie = this.industryElement(industry)
      if (ie) return ie
    }
    const ke = this.keywordElement(name)
    if (ke) return ke
    return this.dominantElement(name)
  }
}
