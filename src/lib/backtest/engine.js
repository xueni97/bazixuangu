/**
 * 回测引擎核心。
 *
 * 流程：
 * 1. 预拉K线 (phase='fetching')
 *    - spot 全市场 → imagery/elements/markets/价格 四级过滤 → 4 并发拉日K
 * 2. 逐日回测 (phase='backtesting')
 *    - buyPointSignal(dt) 判买卖 → historicalScan 截K线算MA+compositeScore → 先卖后买
 * 3. 统计聚合 (phase='charting')
 *    - equityCurve → 日/周/月曲线 + stats
 */

import * as db from '../storage/db.js'
import { fetchSymbolKlines } from '../market/kline.js'
import { computeMaSnapshot, nearMa, classifyMarket } from '../market/ma.js'
import { StockImageryAnalyzer } from '../metaphysics/imagery.js'
import { YuanhaiDecisionModel } from '../metaphysics/model.js'
import {
  createPortfolio, buy, sell, sellAll, tickHoldDays, markToMarket,
} from './portfolio.js'

const MA_WORKERS = 4 // 并发拉K线
const MA_MIN_BARS = 144 // 至少144根K线

/**
 * 四级过滤：spot 全市场 → imagery → elements → markets → 价格。
 */
function filterUniverse(spotRows, model) {
  const { elements, markets, minPrice, maxPrice } = model.params
  const elemSet = elements && elements.length ? new Set(elements) : null
  const mktSet = markets && markets.length ? new Set(markets) : null
  const lo = minPrice != null ? Number(minPrice) : null
  const hi = maxPrice != null ? Number(maxPrice) : null

  const out = []
  for (const s of spotRows) {
    if (!s || !s.symbol || !s.name) continue
    // 价格过滤
    const price = Number(s.close || s.price)
    if (lo != null && price < lo) continue
    if (hi != null && price > hi) continue
    // 市场过滤
    const mkt = classifyMarket(s.symbol)
    if (mktSet && !mktSet.has(mkt) && !mktSet.has('全部')) continue
    // 五行过滤（通过 imagery）
    if (elemSet) {
      const img = StockImageryAnalyzer.analyze(s.name)
      if (!img || !elemSet.has(img.element)) continue
    }
    out.push({ symbol: s.symbol, name: s.name, price })
  }
  return out
}

/**
 * 历史扫描：截K线到当日，算MA+compositeScore。
 */
function historicalScan(model, candidates, klineMap, imgCache, periodData, dt) {
  const dateStr = fmtDate(dt)
  const { ma, maw, maTol } = model.params
  const results = []
  for (const c of candidates) {
    const klines = klineMap.get(c.symbol)
    if (!klines || klines.length < MA_MIN_BARS) continue
    // 截到当日
    const sliced = klines.filter((k) => k[0] <= dateStr)
    if (sliced.length < MA_MIN_BARS) continue
    const maSnap = computeMaSnapshot(c.symbol, sliced)
    if (!maSnap) continue
    // 均线过滤
    if (ma && ma.length) {
      let pass = true
      for (const w of ma) {
        const maVal = w === 288 ? maSnap.ma288 : maSnap.ma144
        if (!maVal) { pass = false; break }
        const [hit] = nearMa(maSnap.close, maVal, maSnap.high20, maTol || 0.03)
        if (!hit) { pass = false; break }
      }
      if (!pass) continue
    }
    // 取象 + 综合评分
    const img = imgCache.get(c.symbol)
    if (!img) continue
    const info = YuanhaiDecisionModel.compositeScore(img, periodData, model.params.periods, c.name)
    results.push({
      symbol: c.symbol,
      name: c.name,
      score: info.score,
      price: maSnap.close,
    })
  }
  return results
}

/**
 * 构建交易日历：取所有K线日期的交集∩，过滤≥startDate。
 */
function buildTradingCalendar(klineMap, startDate) {
  let cal = null
  for (const klines of klineMap.values()) {
    if (!klines || klines.length < MA_MIN_BARS) continue
    const dates = klines.map((k) => k[0]).filter((d) => d >= startDate)
    if (!dates.length) continue
    if (cal == null) cal = new Set(dates)
    else cal = new Set([...cal].filter((d) => new Set(dates).has(d)))
  }
  if (!cal || !cal.size) return []
  return [...cal].sort()
}

function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 主入口：运行回测。
 * @param {object} model - 模型定义
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {function|null} onProgress - (progress) => void
 * @returns {Promise<object>} BacktestResult
 */
export async function runBacktest(model, startDate, onProgress = null) {
  const progress = (phase, done, total) => {
    if (onProgress) onProgress({ phase, done, total })
  }

  // ── 阶段1：预拉K线 ──
  // 三种数据源自动选择（构建期注入 VITE_API_BASE 决定）：
  //   1. 远程模式：VITE_API_BASE 有值 → 优先 POST /api/klines/batch 一次批量拉
  //      缺失再单只 GET /api/klines?symbol=xxx 兜底（服务器 cron 已拉好 SQLite）
  //   2. 本地模式：无 VITE_API_BASE → 优先 IndexedDB kline 仓库（maSync 已缓存）
  //      缺失才 4 并发 fetchSymbolKlines 网络兜底链 + 写回 kline 仓库
  progress('fetching', 0, 1)
  const spotRows = await db.getAll('spot')
  const candidates = filterUniverse(spotRows, model)
  if (!candidates.length) {
    return makeEmptyResult(model, startDate, '无候选股票（检查筛选条件）')
  }

  const API_BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || ''
  const klineMap = new Map()
  let cachedCount = 0
  let missing = candidates

  if (API_BASE) {
    // ── 远程模式：服务器 SQLite 直读 ──
    // 一次 POST /api/klines/batch 拉全部候选（最多 2000 只）
    const CHUNK = 2000
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const chunk = candidates.slice(i, i + CHUNK).map((c) => c.symbol)
      try {
        const resp = await fetch(`${API_BASE}/api/klines/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: chunk }),
        })
        const data = await resp.json()
        const map = (data && data.map) || {}
        for (const sym of chunk) {
          const bars = map[sym]
          if (bars && bars.length >= MA_MIN_BARS) {
            klineMap.set(sym, bars)
            cachedCount++
          }
        }
      } catch (e) {
        // 网络错误继续，下面单只兜底
      }
      progress('fetching', Math.min(i + CHUNK, candidates.length), candidates.length)
    }
    // 缺失的单只兜底
    missing = candidates.filter((c) => !klineMap.has(c.symbol))
    if (missing.length) {
      let mcursor = 0
      const mpull = async () => {
        while (mcursor < missing.length) {
          const c = missing[mcursor++]
          try {
            const r = await fetch(`${API_BASE}/api/klines?symbol=${encodeURIComponent(c.symbol)}`)
            const d = await r.json()
            const bars = d && d.bars
            if (bars && bars.length >= MA_MIN_BARS) klineMap.set(c.symbol, bars)
          } catch (e) { /* 忽略单只失败 */ }
          if (mcursor % 20 === 0) progress('fetching', mcursor, missing.length)
        }
      }
      await Promise.all(Array.from({ length: Math.min(MA_WORKERS, missing.length) }, mpull))
    }
  } else {
    // ── 本地模式：IndexedDB + 网络兜底链 ──
    // 先读本地 kline 仓库（maSync 时已缓存）
    const cachedRows = await db.getAll('kline')
    for (const row of cachedRows) {
      if (row && row.symbol && Array.isArray(row.bars) && row.bars.length) {
        klineMap.set(row.symbol, row.bars)
        cachedCount++
      }
    }
    // 找出本地缺失或K线不足的候选，4并发兜底拉网络
    missing = candidates.filter((c) => !klineMap.has(c.symbol) || (klineMap.get(c.symbol) || []).length < MA_MIN_BARS)
    let cursor = 0
    const newCached = [] // 兜底拉到的也写回 kline 仓库，下次免拉
    const pull = async () => {
      while (cursor < missing.length) {
        const c = missing[cursor++]
        const klines = await fetchSymbolKlines(c.symbol, 'day')
        if (klines && klines.length) {
          klineMap.set(c.symbol, klines)
          if (klines.length >= MA_MIN_BARS) {
            newCached.push({
              symbol: c.symbol,
              bars: klines,
              tradeDate: klines[klines.length - 1][0],
              barsCount: klines.length,
              updatedAt: Date.now(),
            })
          }
        }
        if (cursor % 20 === 0) progress('fetching', cursor, Math.max(missing.length, 1))
      }
    }
    await Promise.all(Array.from({ length: Math.min(MA_WORKERS, missing.length) }, pull))
    // 兜底拉到的批量写回（失败不影响主流程）
    if (newCached.length) {
      try { await db.bulkPut('kline', newCached) } catch (e) { /* 忽略缓存写失败 */ }
    }
  }
  progress('fetching', candidates.length, candidates.length)
  // 进度备注：本地缓存 N 只 / 兜底拉 M 只
  if (onProgress) {
    onProgress({ phase: 'fetching', done: candidates.length, total: candidates.length, cached: cachedCount, missing: missing.length })
  }

  // 过滤掉K线不足的票
  const validCandidates = candidates.filter((c) => klineMap.has(c.symbol))

  // 构建交易日历
  const calendar = buildTradingCalendar(klineMap, startDate)
  if (!calendar.length) {
    return makeEmptyResult(model, startDate, '交易日历为空（起始日期过早或K线不足）')
  }

  // 预缓存取象
  const imgCache = new Map()
  for (const c of validCandidates) {
    const img = StockImageryAnalyzer.analyze(c.name)
    if (img) imgCache.set(c.symbol, img)
  }

  // ── 阶段2：逐日回测 ──
  const pf = createPortfolio(model.initialCapital)
  const trades = []
  const equityCurve = []
  const total = calendar.length

  for (let i = 0; i < total; i++) {
    const dateStr = calendar[i]
    const dt = new Date(dateStr + 'T12:00:00')

    // 信号（纯命理，无K线依赖）
    const signal = YuanhaiDecisionModel.buyPointSignal(dt)

    // 收盘价查询函数
    const closeOf = (sym) => {
      const klines = klineMap.get(sym)
      if (!klines) return 0
      const row = klines.find((k) => k[0] === dateStr)
      return row && row[1] != null ? Number(row[1]) : 0
    }

    // 先卖（按卖出策略 exitStrategy: signal|holdDays|both）
    // signal: 仅按买点信号里的卖出/减仓动作清仓
    // holdDays: 仅按持仓天数到期卖出，忽略信号
    // both: 两者任一触发即卖（取早）
    const exitStrategy = model.exitStrategy || 'both'
    if ((exitStrategy === 'signal' || exitStrategy === 'both')
        && ['卖出', '减仓'].includes(signal.action)) {
      const sells = sellAll(pf, closeOf, dateStr, 'signal')
      trades.push(...sells)
    }
    if (exitStrategy === 'holdDays' || exitStrategy === 'both') {
      const expired = [...pf.positions.values()].filter((p) => p.holdDays >= model.holdDays)
      for (const p of expired) {
        const t = sell(pf, p.symbol, closeOf(p.symbol), dateStr, 'expired')
        if (t) trades.push(t)
      }
    }

    tickHoldDays(pf)

    // 后买
    if (['买入', '轻仓试探'].includes(signal.action)) {
      const periodData = YuanhaiDecisionModel.periodAnalyses(dt)
      const picks = historicalScan(model, validCandidates, klineMap, imgCache, periodData, dt)
        .filter((p) => p.score >= model.threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, model.topN)

      if (picks.length) {
        const budget = pf.cash / picks.length
        for (const p of picks) {
          buy(pf, { ...p, date: dateStr }, budget)
        }
      }
    }

    // 记录净值
    const mtm = markToMarket(pf, closeOf)
    equityCurve.push({ date: dateStr, ...mtm })
    if (i % 5 === 0) progress('backtesting', i + 1, total)
  }
  progress('backtesting', total, total)

  // ── 阶段3：统计聚合 ──
  progress('charting', 0, 1)
  const stats = computeStats(trades, equityCurve, model.initialCapital)
  const weeklyCurve = aggregateByPeriod(equityCurve, 'week')
  const monthlyCurve = aggregateByPeriod(equityCurve, 'month')
  progress('charting', 1, 1)

  return {
    modelId: model.id || model.name,
    modelName: model.name,
    startDate,
    endDate: calendar[calendar.length - 1],
    status: 'done',
    trades,
    equityCurve,
    stats,
    weeklyCurve,
    monthlyCurve,
    candidateCount: validCandidates.length,
    tradeDays: total,
  }
}

/**
 * 计算统计指标。
 */
function computeStats(trades, equityCurve, initialCapital) {
  const totalReturn = equityCurve.length
    ? equityCurve[equityCurve.length - 1].totalReturn
    : 0

  // 年化收益
  const days = equityCurve.length
  const annualizedReturn = days > 0
    ? Math.round((Math.pow(1 + totalReturn / 100, 252 / days) - 1) * 10000) / 100
    : 0

  // 胜率
  const wins = trades.filter((t) => t.pnlPct > 0).length
  const losses = trades.filter((t) => t.pnlPct < 0).length
  const winRate = trades.length
    ? Math.round((wins / trades.length) * 1000) / 10
    : null

  // 平均持仓天数
  const avgHold = trades.length
    ? Math.round((trades.reduce((s, t) => s + t.holdDays, 0) / trades.length) * 10) / 10
    : null

  // 最大回撤
  let maxDrawdown = 0
  let peak = -Infinity
  for (const p of equityCurve) {
    const val = p.totalValue
    if (val > peak) peak = val
    const dd = (peak - val) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  maxDrawdown = Math.round(maxDrawdown * 10) / 10

  return {
    totalReturn,
    annualizedReturn,
    winRate,
    avgHold,
    maxDrawdown,
    tradeCount: trades.length,
    buyDays: equityCurve.filter((p, i) => i > 0 && p.totalValue !== equityCurve[i - 1].totalValue).length,
  }
}

/**
 * 按周/月聚合净值曲线。
 */
function aggregateByPeriod(curve, period = 'week') {
  if (!curve.length) return []
  const map = new Map()
  for (const p of curve) {
    const d = new Date(p.date + 'T12:00:00')
    let key
    if (period === 'week') {
      // ISO 周序
      const onejan = new Date(d.getFullYear(), 0, 1)
      key = `${d.getFullYear()}-W${Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)}`
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    if (!map.has(key)) map.set(key, p)
    else map.set(key, p) // 取最后一根
  }
  return [...map.values()].map((p) => ({
    date: p.date,
    totalReturn: p.totalReturn,
  }))
}

function makeEmptyResult(model, startDate, reason) {
  return {
    modelId: model.id || model.name,
    modelName: model.name,
    startDate,
    endDate: startDate,
    status: 'empty',
    reason,
    trades: [],
    equityCurve: [],
    stats: { totalReturn: 0, annualizedReturn: 0, winRate: null, avgHold: null, maxDrawdown: 0, tradeCount: 0, buyDays: 0 },
    weeklyCurve: [],
    monthlyCurve: [],
    candidateCount: 0,
    tradeDays: 0,
  }
}
