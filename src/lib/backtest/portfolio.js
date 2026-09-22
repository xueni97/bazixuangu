/**
 * 回测持仓管理（纯函数，无 IO 依赖）。
 *
 * 资金守恒：cash + positionValue = totalValue。
 * 整手买入：Math.floor(budget / price / 100) * 100。
 */

const LOT = 100 // A 股最小交易单位

/**
 * 创建空持仓。
 * @param {number} initialCapital - 初始资金
 */
export function createPortfolio(initialCapital = 1000000) {
  return {
    cash: initialCapital,
    initialCapital,
    positions: new Map(), // symbol → { symbol, name, shares, entryPrice, entryDate, score, holdDays: 0 }
  }
}

/**
 * 买入：等权分配预算，整手买入。
 * @param {object} pf - portfolio
 * @param {object} pick - { symbol, name, price, date, score }
 * @param {number} budget - 该票预算
 * @returns {object|null} 买入的持仓记录（null 表示资金不足）
 */
export function buy(pf, pick, budget) {
  if (!pick || !(pick.price > 0) || budget <= 0) return null
  const shares = Math.floor(budget / pick.price / LOT) * LOT
  if (shares <= 0) return null
  const cost = shares * pick.price
  if (cost > pf.cash) return null
  pf.cash -= cost
  const pos = {
    symbol: pick.symbol,
    name: pick.name || pick.symbol,
    shares,
    entryPrice: pick.price,
    entryDate: pick.date,
    score: pick.score ?? null,
    holdDays: 0,
  }
  pf.positions.set(pick.symbol, pos)
  return pos
}

/**
 * 卖出：全部持仓。
 * @param {object} pf - portfolio
 * @param {string} symbol
 * @param {number} price - 卖出价
 * @param {string} date - 卖出日
 * @param {string} reason - 卖出原因
 * @returns {object|null} 交易记录（null 表示无持仓）
 */
export function sell(pf, symbol, price, date, reason = 'signal') {
  const pos = pf.positions.get(symbol)
  if (!pos || !(price > 0)) return null
  const proceeds = pos.shares * price
  pf.cash += proceeds
  pf.positions.delete(symbol)
  const pnlPct = Math.round(((price - pos.entryPrice) / pos.entryPrice) * 10000) / 100
  return {
    symbol: pos.symbol,
    name: pos.name,
    entryDate: pos.entryDate,
    entryPrice: pos.entryPrice,
    exitDate: date,
    exitPrice: price,
    holdDays: pos.holdDays,
    pnlPct,
    exitReason: reason,
    score: pos.score,
  }
}

/**
 * 卖出所有持仓（卖出信号或清仓）。
 * @param {object} pf
 * @param {number} price - 每只票的卖出价（由调用方传入 map）
 * @param {function} priceFn - (symbol) => price
 * @param {string} date
 * @param {string} reason
 * @returns {Array} 交易记录数组
 */
export function sellAll(pf, priceFn, date, reason = 'signal') {
  const trades = []
  for (const [sym, pos] of pf.positions) {
    const price = priceFn(sym)
    if (price > 0) {
      const t = sell(pf, sym, price, date, reason)
      if (t) trades.push(t)
    }
  }
  return trades
}

/**
 * 持仓天数 +1（每个交易日调用）。
 */
export function tickHoldDays(pf) {
  for (const pos of pf.positions.values()) pos.holdDays += 1
}

/**
 * 按当日收盘价估值。
 * @param {object} pf
 * @param {function} priceFn - (symbol) => close price
 * @returns {{ cash, positionValue, totalValue, totalReturn }}
 */
export function markToMarket(pf, priceFn) {
  let positionValue = 0
  for (const [sym, pos] of pf.positions) {
    const price = priceFn(sym)
    if (price > 0) positionValue += pos.shares * price
  }
  const totalValue = pf.cash + positionValue
  const totalReturn = Math.round(((totalValue / pf.initialCapital) - 1) * 10000) / 100
  return { cash: pf.cash, positionValue, totalValue, totalReturn }
}
