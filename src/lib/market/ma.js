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
 * 日K → 均线快照。klines 为 [[date, close], ...]。
 * 上市不足 144 个交易日返回 null。
 * high20：不含当日的最近 20 个交易日最高收盘，用于"回踩"判定。
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
 * 2. 回踩：此前 20 个交易日内最高收盘曾站上均线上沿 ma*(1+tol)，
 *    即股价是从上方跌回均线，而非一直在线下徘徊。
 * 返回 [是否命中, 距离比例 price/ma-1]；缺数据返回 [false, null]。
 */
export function nearMa(price, ma, high20, tol) {
  if (!price || !ma || price <= 0) return [false, null]
  const dist = price / ma - 1.0
  if (Math.abs(dist) > tol + 1e-9) return [false, round4(dist)]
  if (!high20 || high20 <= ma * (1 + tol)) return [false, round4(dist)]
  return [true, round4(dist)]
}
