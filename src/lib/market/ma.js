/**
 * 长周期均线(144/288)计算与"回踩均线附近"判定。
 *
 * 由 server/data_sync.py 的 compute_ma_snapshot / near_ma 翻译。
 * 纯函数，无网络/存储依赖，可在主线程直接调用。
 */

/** 行情值规范化：'-'/NaN/0/None → null。 */
export function toNum(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null
  const f = typeof v === 'number' ? v : parseFloat(v)
  if (Number.isNaN(f) || f === 0) return null
  return f
}

/** 按代码前缀划分市场。 */
export function classifyMarket(symbol) {
  if (/^(60|68)/.test(symbol)) return '沪'
  if (/^(00|30)/.test(symbol)) return '深'
  return '北交所'
}

function round4(x) {
  return Math.round(x * 10000) / 10000
}

/**
 * K 线 → 均线快照。klines 为 [[date, close], ...]。
 * 日K传入得日均线（144/288交易日），周K传入得周均线（144/288交易周），计算同构。
 * 上市不足 144 根K线返回 null。
 * high20：不含当根的最近 20 根最高收盘，用于"回踩"判定。
 */
export function computeMaSnapshot(symbol, klines) {
  const closes = klines.map(([, c]) => c).filter(c => c)
  const n = closes.length
  if (n < 144) return null
  const last = klines[klines.length - 1]
  return {
    symbol,
    tradeDate: last[0],
    close: round4(closes[n - 1]),
    high20: n >= 21 ? round4(Math.max(...closes.slice(-21, -1))) : null,
    bars: n,
    ma144: round4(closes.slice(-144).reduce((s, c) => s + c, 0) / 144),
    ma288: n >= 288 ? round4(closes.slice(-288).reduce((s, c) => s + c, 0) / 288) : null,
  }
}

/**
 * 是否"下跌至均线附近"。
 * 判定（两条同时成立）：
 * 1. 附近：|price/ma - 1| <= tol（默认 3%）；
 * 2. 回踩：此前 20 根K线（交易日/交易周）内最高收盘曾站上均线上沿 ma*(1+tol)，
 *    即股价是从上方跌回均线，而非一直在线下徘徊。
 * 返回 [是否命中, 距离比例 price/ma-1]；缺数据返回 [false, null]。
 */
export function nearMa(price, ma, high20, tol, tolDown = null) {
  if (!price || !ma || price <= 0) return [false, null]
  const dist = price / ma - 1.0
  // 容差上下分开：上方（price>ma）用 tol，下方用 tolDown（缺省=tol 对称，向后兼容）。
  // 回踩场景：允许股价在均线上方 5% 以内、下方 2% 以内 → tol=0.05, tolDown=0.02
  const down = tolDown == null ? tol : tolDown
  if (dist > tol + 1e-9 || dist < -down - 1e-9) return [false, round4(dist)]
  // 回踩语义：前20日/周最高只要曾经站上过均线（high20 > ma）即可，
  // 不要求 high20 > ma*(1+tol)（突破过 tol 以上）——对 288 周线等长周期均线，
  // 前20周可能只略高于均线未达 +tol%，但仍是有效的"回踩"
  if (!high20 || high20 <= ma) return [false, round4(dist)]
  return [true, round4(dist)]
}

/**
 * 周线均线趋势细分（避免选出下跌趋势票）。
 *
 * 多维度分类：
 *   priceVsMa144：股价相对周144（above上/below下/near附近）
 *   ma144VsMa288：周144相对周288（above多头排列/below空头排列/near缠绕）
 *   weekVs288：周线收盘相对288的位置关系
 *     - near：靠近288（容差内）
 *     - far_above：远离288上方（强势）
 *     - far_below：远离288下方（弱势）
 *     - below：跌破288（曾在上方，现跌破）
 *     - reclaim：跌破收回（high20曾跌破288，现回到288附近或之上）
 *   trend：综合趋势（bull多头/bear空头/rebound跌破收回/consolidation盘整）
 *
 * @param {number} close 周线收盘价
 * @param {number} ma144 周线144
 * @param {number} ma288 周线288
 * @param {number} high20 前20周最高收盘
 * @param {number} tol 容差（默认0.03）
 * @returns {object} 趋势分类
 */
export function classifyMaTrend(close, ma144, ma288, high20, tol = 0.03) {
  const ret = {
    priceVsMa144: null,
    ma144VsMa288: null,
    weekVs288: null,
    trend: null,
  }
  if (!close || !ma144 || close <= 0) return ret

  // 股价 vs 周144
  const d144 = close / ma144 - 1
  if (Math.abs(d144) <= tol) ret.priceVsMa144 = 'near'
  else ret.priceVsMa144 = d144 > 0 ? 'above' : 'below'

  if (!ma288) {
    ret.trend = ret.priceVsMa144 === 'above' ? 'bull' : 'bear'
    return ret
  }

  // 周144 vs 周288（多头/空头排列）
  const d144_288 = ma144 / ma288 - 1
  if (Math.abs(d144_288) <= tol) ret.ma144VsMa288 = 'near'
  else ret.ma144VsMa288 = d144_288 > 0 ? 'above' : 'below'

  // 周线 vs 288
  const d288 = close / ma288 - 1
  if (Math.abs(d288) <= tol) {
    // 靠近288：检查是否曾跌破（reclaim）
    if (high20 && high20 < ma288 * (1 - tol)) {
      ret.weekVs288 = 'reclaim'
    } else {
      ret.weekVs288 = 'near'
    }
  } else if (d288 > 0) {
    ret.weekVs288 = 'far_above'
  } else {
    // 下方：跌破还是远离下方
    if (high20 && high20 >= ma288 * (1 - tol)) {
      ret.weekVs288 = 'below'
    } else {
      ret.weekVs288 = 'far_below'
    }
  }

  // 综合趋势
  if (ret.ma144VsMa288 === 'above' && ret.priceVsMa144 === 'above') ret.trend = 'bull'
  else if (ret.ma144VsMa288 === 'below' && ret.priceVsMa144 === 'below') ret.trend = 'bear'
  else if (ret.weekVs288 === 'reclaim') ret.trend = 'rebound'
  else ret.trend = 'consolidation'

  return ret
}

/**
 * 周线趋势是否匹配用户选定的细分类型。
 *
 * @param {object} trend classifyMaTrend 返回值
 * @param {string[]} weekPositions 用户选定的 weekVs288 类型（空=不过滤）
 * @param {boolean} ma144AbovePrice 要求144在股价之上（压制位，过滤纯下跌）
 * @param {boolean} ma144AboveMa288 要求144在288之上（多头排列）
 */
export function matchMaTrend(trend, weekPositions = [], ma144AbovePrice = false, ma144AboveMa288 = false) {
  if (!trend) return false
  if (weekPositions && weekPositions.length) {
    if (!weekPositions.includes(trend.weekVs288)) return false
  }
  if (ma144AbovePrice && trend.priceVsMa144 !== 'below') return false
  if (ma144AboveMa288 && trend.ma144VsMa288 !== 'above') return false
  return true
}

/**
 * 日 K 聚合为周 K（按 ISO 周分组，取每周最后交易日的收盘）。
 * 用于回测时从日 K 算周均线趋势，免单独拉周 K。
 * @param {Array} dayKlines [[date, close], ...]
 * @returns {Array} 周K [[date, close], ...]
 */
export function aggregateWeekly(dayKlines) {
  if (!dayKlines || !dayKlines.length) return []
  const weekMap = new Map()
  for (const [date, close] of dayKlines) {
    if (!date || close == null) continue
    const d = new Date(date + 'T12:00:00')
    if (Number.isNaN(d.getTime())) continue
    // ISO 周四为周中，用作分组锚点
    const tmp = new Date(d)
    tmp.setHours(12, 0, 0, 0)
    const day = tmp.getDay() || 7
    tmp.setDate(tmp.getDate() - (day - 4))
    const weekKey = `${tmp.getFullYear()}-${tmp.getMonth() + 1}-${tmp.getDate()}`
    weekMap.set(weekKey, [date, Number(close)])
  }
  return [...weekMap.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}
