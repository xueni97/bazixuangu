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
import { computeMaSnapshot, nearMa, classifyMarket, classifyMaTrend, matchMaTrend, aggregateWeekly } from '../market/ma.js'
import { currentApiBase } from '../market/maSync.js'
import { StockImageryAnalyzer } from '../metaphysics/imagery.js'
import { YuanhaiDecisionModel } from '../metaphysics/model.js'
import { getAlmanac } from '../metaphysics/almanac.js'
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
  const { ma, maw, maTol, weekPositions, ma144AbovePrice, ma144AboveMa288 } = model.params
  const hasWeekFilter = (weekPositions && weekPositions.length) || ma144AbovePrice || ma144AboveMa288
  const results = []
  for (const c of candidates) {
    const klines = klineMap.get(c.symbol)
    if (!klines || klines.length < MA_MIN_BARS) continue
    // 截到当日
    const sliced = klines.filter((k) => k[0] <= dateStr)
    if (sliced.length < MA_MIN_BARS) continue
    const maSnap = computeMaSnapshot(c.symbol, sliced)
    if (!maSnap) continue
    // 均线过滤（日线）
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
    // 周线均线过滤（maw 参数）
    if (maw && maw.length) {
      const weekKlines = aggregateWeekly(sliced)
      if (weekKlines.length < MA_MIN_BARS) continue
      const weekSnap = computeMaSnapshot(c.symbol, weekKlines)
      if (!weekSnap) continue
      let pass = true
      for (const w of maw) {
        const maVal = w === 288 ? weekSnap.ma288 : weekSnap.ma144
        if (!maVal) { pass = false; break }
        const [hit] = nearMa(weekSnap.close, maVal, weekSnap.high20, maTol || 0.03)
        if (!hit) { pass = false; break }
      }
      if (!pass) continue
    }
    // 周线趋势细分过滤（避免下跌趋势）
    if (hasWeekFilter) {
      const weekKlines = aggregateWeekly(sliced)
      if (weekKlines.length < MA_MIN_BARS) continue
      const weekSnap = computeMaSnapshot(c.symbol, weekKlines)
      if (!weekSnap || !weekSnap.ma288) continue
      const trend = classifyMaTrend(
        weekSnap.close, weekSnap.ma144, weekSnap.ma288, weekSnap.high20, maTol || 0.03,
      )
      if (!matchMaTrend(trend, weekPositions, ma144AbovePrice, ma144AboveMa288)) continue
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
      stem: img.primaryStem, // 十干类象：同质化去重用（行业数据缺失的近似）
    })
  }
  return results
}

/**
 * 日期标准化：'YYYY-MM-DD'（容错 '/' 分隔符与时间后缀，如东财 '2026-01-05 00:00:00'）。
 * 防止个别票格式不同污染交易日历。
 */
function normDate(d) {
  if (typeof d !== 'string') return null
  const s = d.replace('/', '-').split(' ')[0]
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * 构建交易日历：取所有K线日期的并集∪（当天有票交易即为交易日），过滤≥startDate。
 *
 * 旧版用全票严格交集：5000+ 只票任何一只日期格式异常/数据损坏/窗口错开，
 * 交集即清空 → 误报"交易日历为空"（即使数据齐全）。
 * 并集语义正确：日历只决定"回测哪些天"，某票当日停牌无K线时
 * historicalScan 里按该票自己的 sliced 截断判断，自然跳过，无副作用。
 */
function buildTradingCalendar(klineMap, startDate) {
  const cal = new Set()
  for (const klines of klineMap.values()) {
    if (!klines || klines.length < MA_MIN_BARS) continue
    for (const k of klines) {
      const d = normDate(k && k[0])
      if (d && d >= startDate) cal.add(d)
    }
  }
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
  const logs = []
  const log = (msg) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`
    logs.push(entry)
    if (onProgress) onProgress({ phase: 'logging', log: entry })
  }

  // ── 阶段1：预拉K线 ──
  // 数据源跟随运行时切换（与扫描/同步一致，localStorage 'bazi_data_source'）：
  //   server 模式：POST /api/klines/batch 批量拉服务器 SQLite（cron 已同步）
  //   local 模式：优先 IndexedDB kline 仓库（maSync 已缓存），
  //     缺失才 4 并发 fetchSymbolKlines 网络兜底链 + 写回 kline 仓库
  progress('fetching', 0, 1)
  const spotRows = await db.getAll('spot')
  const candidates = filterUniverse(spotRows, model)
  if (!candidates.length) {
    return makeEmptyResult(model, startDate, '无候选股票（检查筛选条件）')
  }

  const API_BASE = currentApiBase()
  const klineMap = new Map()
  let cachedCount = 0
  let missing = candidates

  if (API_BASE) {
    // ── 远程模式：服务器 SQLite 直读 ──
    // POST /api/klines/batch 分批拉（CHUNK=200，每批 ~25MB；
    // 2000 只一批响应体过大触发 ERR_CONTENT_LENGTH_MISMATCH 连接被切断，
    // 且 catch 静默吞错导致 0 只命中误报"服务器缓存为空"）
    const CHUNK = 200
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const chunk = candidates.slice(i, i + CHUNK).map((c) => c.symbol)
      try {
        const resp = await fetch(`${API_BASE}/api/klines/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: chunk }),
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
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
        console.warn(`[回测] batch ${chunk.length}只失败，本批降级单只兜底`, e.message)
        // 本批降级单只兜底（不丢整批数据）
        for (const sym of chunk) {
          try {
            const r = await fetch(`${API_BASE}/api/klines?symbol=${encodeURIComponent(sym)}`)
            if (r.ok) {
              const d = await r.json()
              if (d && d.bars && d.bars.length >= MA_MIN_BARS) {
                klineMap.set(sym, d.bars)
                cachedCount++
              }
            }
          } catch { /* 单只失败跳过 */ }
        }
      }
      progress('fetching', Math.min(i + CHUNK, candidates.length), candidates.length)
    }
    // 缺失的单只兜底
    missing = candidates.filter((c) => !klineMap.has(c.symbol))
    // 数据严重不全（>30% 缺失）：直接提示先补数据，避免逐只兜底几十分钟
    if (missing.length > 500 && missing.length / candidates.length > 0.3) {
      return makeEmptyResult(
        model, startDate,
        `服务器 K 线缓存仅 ${klineMap.size}/${candidates.length} 只，` +
        `${missing.length} 只缺失需逐只兜底（太慢）。请先在服务器跑：` +
        ` nohup .venv/bin/python server/sync_once.py 拉全市场K线后再回测。`)
    }
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

  // 统一标准化所有K线：日期 normDate（容错格式/时间后缀）、收盘 Number
  // 后续 sliced 截断、MA 计算、日历构建全部依赖字符串日期比较，必须先洗干净
  for (const [sym, bars] of klineMap) {
    const cleaned = bars
      .map((k) => [normDate(k && k[0]), Number(k && k[1])])
      .filter((k) => k[0] && Number.isFinite(k[1]) && k[1] > 0)
    if (cleaned.length >= MA_MIN_BARS) klineMap.set(sym, cleaned)
    else klineMap.delete(sym)
  }
  // 进度备注：本地缓存 N 只 / 兜底拉 M 只
  if (onProgress) {
    onProgress({ phase: 'fetching', done: candidates.length, total: candidates.length, cached: cachedCount, missing: missing.length })
  }
  log(`阶段1完成：候选 ${candidates.length} 只，有效K线 ${klineMap.size} 只` +
      (cachedCount != null ? `（缓存 ${cachedCount} / 兜底 ${missing.length}）` : ''))

  // 过滤掉K线不足的票
  const validCandidates = candidates.filter((c) => klineMap.has(c.symbol))

  // 构建交易日历
  const calendar = buildTradingCalendar(klineMap, startDate)
  if (!calendar.length) {
    return makeEmptyResult(model, startDate, '交易日历为空（起始日期过早或K线不足）')
  }
  log(`交易日历 ${calendar.length} 日（${calendar[0]} → ${calendar[calendar.length - 1]}）`)

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
  // 强制止损/止盈阈值（%，0 = 禁用）
  const stopLossPct = Number(model.stopLossPct) || 0
  const takeProfitPct = Number(model.takeProfitPct) || 0
  // 移动止盈：高点回撤超此值出场（0 = 禁用）——盈亏比倒置对策
  const trailingPct = Number(model.trailingPct) || 0
  // 仓位管理：单票上限%（默认20）、总仓位上限%（默认95）
  const maxSinglePct = Number(model.maxSinglePct) || 20
  const maxPositionPct = Number(model.maxPositionPct) || 95
  if (stopLossPct > 0 || takeProfitPct > 0) {
    log(`风控：强制止损 ${stopLossPct > 0 ? '-' + stopLossPct + '%' : '禁用'}` +
        ` / 止盈 ${takeProfitPct > 0 ? '+' + takeProfitPct + '%' : '禁用'}` +
        ` / 移动止盈 ${trailingPct > 0 ? '高点回撤-' + trailingPct + '%' : '禁用'}`)
  }
  log(`仓位：单票 ≤${maxSinglePct}% / 总仓位 ≤${maxPositionPct}%` +
      `（佣金0.025%双边+印花税0.05%卖出）`)
  // 选股门槛实际生效值打印——避免与已保存模型列表混淆（同一页可存多条模型）
  log(`选股门槛：综合分 ≥${model.threshold} · 买入上限 ${model.topN} 只 · 起始 ${startDate}`)

  for (let i = 0; i < total; i++) {
    const dateStr = calendar[i]
    const dt = new Date(dateStr + 'T12:00:00')

    // 信号（月0.5/周0.3/日0.2加权，月买点力量最大，不再只看日买点）
    const signal = YuanhaiDecisionModel.weightedBuyPointSignal(dt, model.params.periods)

    // 收盘价查询：当日精确匹配；停牌/缺数据回退最近收盘价（last价惯例）。
    // 旧版精确匹配失败返回 0 → 卖出失败+持仓市值归零 → 总收益-99.88%假象
    // 且持仓永远卖不掉（交易 0 笔）。二分查找 O(log n)。
    const closeOf = (sym) => {
      const klines = klineMap.get(sym)
      if (!klines || !klines.length) return 0
      let lo = 0, hi = klines.length - 1, ans = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (klines[mid][0] <= dateStr) { ans = mid; lo = mid + 1 } else hi = mid - 1
      }
      return ans >= 0 ? Number(klines[ans][1]) || 0 : 0
    }

    // ── 卖出规则（按用户定版优先级逐日执行，同票先触发先出场）──
    // 止损 > 移动止盈 > 信号卖出 > 止盈 > 持仓到期（凶日避险无条件最高）
    const exitStrategy = model.exitStrategy || 'both'

    // 1. 止损 / 移动止盈 / 止盈（价格规则，同循环内 reason 按优先级标注）
    // 盈亏比倒置对策：trailing 让盈利单奔跑，高点回撤超阈值才出场
    let soldStop = 0
    if (stopLossPct > 0 || takeProfitPct > 0 || trailingPct > 0) {
      for (const [sym, p] of [...pf.positions]) {
        const price = closeOf(sym)
        if (!(price > 0)) continue
        if (trailingPct > 0 && price > (p.highPrice || p.entryPrice)) {
          p.highPrice = price // 更新持仓期间最高价
        }
        const pnl = ((price - p.entryPrice) / p.entryPrice) * 100
        const drawdown = ((price - (p.highPrice || p.entryPrice)) / (p.highPrice || p.entryPrice)) * 100
        let reason = null
        if (stopLossPct > 0 && pnl <= -stopLossPct) reason = 'stopLoss'
        else if (trailingPct > 0 && drawdown <= -trailingPct) reason = 'trailing'
        else if (takeProfitPct > 0 && pnl >= takeProfitPct) reason = 'takeProfit'
        if (reason) {
          const t = sell(pf, sym, price, dateStr, reason)
          if (t) { trades.push({ ...t, type: 'sell' }); soldStop++ }
        }
      }
    }

    // 2. 信号卖出：默认只清浮亏/平盘票（signalSellLosersOnly）。
    // 浮盈票不被周/日翻空截断利润，交给移动止盈管理高点回撤——
    // "刚有浮盈就信号清仓、利润被提前截断"的对策。
    // 浮盈票若信号持续翻空转为浮亏，次日自然被清，逻辑自洽。
    let soldSignal = 0
    if ((exitStrategy === 'signal' || exitStrategy === 'both')
        && ['卖出', '减仓'].includes(signal.action)) {
      for (const [sym, p] of [...pf.positions]) {
        const price = closeOf(sym)
        if (!(price > 0)) continue
        const pnl = ((price - p.entryPrice) / p.entryPrice) * 100
        if (model.signalSellLosersOnly !== false && pnl > 0) continue
        const t = sell(pf, sym, price, dateStr, 'signal')
        if (t) { trades.push({ ...t, type: 'sell' }); soldSignal++ }
      }
    }

    // 3. 持仓到期
    let soldExpired = 0
    if (exitStrategy === 'holdDays' || exitStrategy === 'both') {
      const expired = [...pf.positions.values()].filter((p) => p.holdDays >= model.holdDays)
      for (const p of expired) {
        const t = sell(pf, p.symbol, closeOf(p.symbol), dateStr, 'expired')
        if (t) { trades.push({ ...t, type: 'sell' }); soldExpired++ }
      }
    }
    // 凶日前一交易日强制避险卖出（择日学：四离/四绝/岁破/月破等凶日不开新仓、
    // 持仓过凶日风险大，提前一日收盘离场）。同时当日禁止再买入——否则卖出后
    // 立即买回新票，等于持仓过凶日，避险失效。
    let soldAlmanacEve = 0
    const nextDateStr = calendar[i + 1]
    let nextInauspicious = false
    if (nextDateStr && model.almanacEveSell !== false) {
      const [ny, nm, nd] = nextDateStr.split('-').map(Number)
      const alm = getAlmanac(new Date(ny, nm - 1, nd, 12))
      nextInauspicious = !!(alm && alm.inauspicious)
      if (nextInauspicious && pf.positions.size) {
        const sells = sellAll(pf, closeOf, dateStr, 'almanacEve')
        trades.push(...sells.map((t) => ({ ...t, type: 'sell' })))
        soldAlmanacEve = sells.length
      }
    }

    tickHoldDays(pf)

    // 后买：总持仓数硬上限 = topN（旧版无上限，持仓能涨到 17 只超 topN=5），
    // 剩余现金分给空位（budget = cash/slots，滚动满仓语义）
    let boughtCount = 0
    let candidateN = null, qualifiedN = null
    if (!nextInauspicious && ['买入', '轻仓试探'].includes(signal.action)) {
      const slots = model.topN - pf.positions.size
      if (slots > 0) {
        const periodData = YuanhaiDecisionModel.periodAnalyses(dt)
        const allPicks = historicalScan(model, validCandidates, klineMap, imgCache, periodData, dt)
        candidateN = allPicks.length
        const qualified = allPicks
          .filter((p) => p.score >= model.threshold)
          .sort((a, b) => b.score - a.score)
        // 已持仓票不重复买（buy 层也有保护，双保险）
        // 同质化去重：同天干类象（行业数据缺失的近似）每日最多 2 只，
        // 避免"一堆智能类小票"高度相关、板块下跌集体回撤
        const stemCount = new Map()
        const picks = []
        for (const p of qualified) {
          if (picks.length >= slots) break
          if (pf.positions.has(p.symbol)) continue
          const c = stemCount.get(p.stem) || 0
          if (c >= 2) continue
          stemCount.set(p.stem, c + 1)
          picks.push(p)
        }
        qualifiedN = qualified.length
        if (picks.length) {
          // 三重预算上限（亏损放大器对策）：
          // 1. 现金均分空位；2. 单票 ≤ 总资产 maxSinglePct%；3. 买入后总仓位 ≤ maxPositionPct%
          const mtm0 = markToMarket(pf, closeOf)
          const perSlot = Math.min(
            pf.cash / picks.length,
            (mtm0.totalValue * maxSinglePct) / 100,
            Math.max(0, (mtm0.totalValue * maxPositionPct) / 100 - mtm0.positionValue) / picks.length,
          )
          for (const p of picks) {
            const budget = Math.min(perSlot, pf.cash)
            if (budget <= 0) break
            const pos = buy(pf, { ...p, date: dateStr }, budget)
            if (pos) {
              boughtCount++
              // 买入明细记录（交易明细买卖都显示）
              trades.push({
                type: 'buy', symbol: p.symbol, name: p.name,
                date: dateStr, price: p.price,
                shares: pos.shares, cost: pos.entryCost,
                score: p.score,
              })
            }
          }
        }
      }
    }

    // 记录净值
    const mtm = markToMarket(pf, closeOf)
    equityCurve.push({ date: dateStr, ...mtm })

    // 每日日志（全量，回测日志可折叠展示）：
    // 月/周/日分项信号 + 黄历降级 + 候选/达标数 + 买卖数 + 持仓/现金/净值
    // 起始日到首笔交易的空窗原因直接体现在逐日信号里
    const pd = signal.periodDetail || {}
    const pdStr = ['monthly', 'weekly', 'daily']
      .filter((p) => pd[p])
      .map((p) => `${p === 'monthly' ? '月' : p === 'weekly' ? '周' : '日'}${pd[p].action}(${pd[p].signalScore})`)
      .join(' ')
    const almStr = signal.almanac && signal.almanac.inauspicious
      ? ` [黄历凶:${(signal.almanac.reasons || []).join('/')}]` : ''
    log(`${dateStr} 信号=${signal.action}(${signal.signalScore}) ${pdStr}${almStr}` +
        (candidateN != null ? ` 候选${candidateN}/达标${qualifiedN}` : (nextInauspicious ? ' 次日凶日' : ' 未选票')) +
        (soldSignal ? ` 信号卖出${soldSignal}` : '') +
        (soldExpired ? ` 到期卖出${soldExpired}` : '') +
        (soldStop ? ` 止损止盈${soldStop}` : '') +
        (soldAlmanacEve ? ` 凶日前避险${soldAlmanacEve}` : '') +
        (boughtCount ? ` 买入${boughtCount}只` : '') +
        ` 持仓${pf.positions.size} 现金${Math.round(pf.cash)} 净值${mtm.totalReturn}%`)
    if (i % 5 === 0) progress('backtesting', i + 1, total)
  }
  progress('backtesting', total, total)

  // ── 阶段3：统计聚合 ──
  progress('charting', 0, 1)
  const stats = computeStats(trades, equityCurve, model.initialCapital)
  const weeklyCurve = aggregateByPeriod(equityCurve, 'week')
  const monthlyCurve = aggregateByPeriod(equityCurve, 'month')
  progress('charting', 1, 1)
  log(`回测完成：总收益 ${stats.totalReturn}% 年化 ${stats.annualizedReturn}%` +
      ` 胜率 ${stats.winRate ?? '—'}% 最大回撤 ${stats.maxDrawdown}%` +
      ` 交易 ${stats.tradeCount} 笔 候选 ${validCandidates.length} 只`)

  return {
    modelId: model.id || model.name,
    modelName: model.name,
    startDate,
    endDate: calendar[calendar.length - 1],
    status: 'done',
    logs,
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
  // 只用卖出配对记录算统计（买入记录 type='buy' 仅展示用）
  const sells = trades.filter((t) => t.type !== 'buy')
  const totalReturn = equityCurve.length
    ? equityCurve[equityCurve.length - 1].totalReturn
    : 0

  // 年化收益
  const days = equityCurve.length
  const annualizedReturn = days > 0
    ? Math.round((Math.pow(1 + totalReturn / 100, 252 / days) - 1) * 10000) / 100
    : 0

  // 胜率
  const wins = sells.filter((t) => t.pnlPct > 0).length
  const losses = sells.filter((t) => t.pnlPct < 0).length
  const winRate = sells.length
    ? Math.round((wins / sells.length) * 1000) / 10
    : null

  // 平均持仓天数
  const avgHold = sells.length
    ? Math.round((sells.reduce((s, t) => s + t.holdDays, 0) / sells.length) * 10) / 10
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
    tradeCount: sells.length,
    buyCount: trades.length - sells.length,
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
