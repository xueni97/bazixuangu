/**
 * 自选观察池：勾选入池 + T+1 收盘自动结算胜率。
 *
 * 记录主键 id = `${signalDate}_${symbol}`，同信号日同票不重复入池；
 * 不同信号日可重复（每次信号独立计胜率）。
 *
 * 结算口径：信号日收盘价入场，信号日之后第一根日K收盘判胜负：
 *   涨 = win（吃肉/见红），跌 = lose（浮亏/吃面），|涨跌|<0.01% = flat（白玩）。
 */

import * as db from './storage/db.js'

const FLAT_EPS = 0.01 // |涨跌幅%| 小于此值记平

function pad2(n) { return String(n).padStart(2, '0') }
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function recordId(signalDate, symbol) {
  return `${signalDate}_${symbol}`
}

/**
 * 纯函数：用日K（[[date, close], ...]）给一条 pending 记录结算。
 * 返回结算字段对象；尚不能结算返回 null。便于单测，无 IO 依赖。
 */
export function evaluateNextBar(rec, klines) {
  if (!rec || rec.status === 'settled') return null
  if (!Array.isArray(klines) || !klines.length || rec.entryPrice == null) return null
  const sorted = klines
    .filter((k) => k && k[0] && k[1] != null)
    .map((k) => [k[0], Number(k[1])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const next = sorted.find((k) => k[0] > rec.signalDate)
  if (!next) return null
  const [nextTradeDate, close] = next
  if (!(close > 0) || !(rec.entryPrice > 0)) return null
  const pnlPct = Math.round(((close - rec.entryPrice) / rec.entryPrice) * 10000) / 100
  let result = 'flat'
  if (pnlPct > FLAT_EPS) result = 'win'
  else if (pnlPct < -FLAT_EPS) result = 'lose'
  return { status: 'settled', nextTradeDate, exitPrice: close, pnlPct, result }
}

/** 信号日：优先日均线表的最新交易日（周末/盘中勾选都锚定真实交易日）。 */
export async function getSignalDate() {
  const td = await db.getMeta('ma_trade_date')
  return td || todayStr()
}

/**
 * 批量加入自选。
 * items：扫描结果行（至少含 symbol/name/score，价格取 item.price，缺则回退日均线收盘）。
 * opts：{ source:'manual'|'auto', periods:[...], filtersLabel, filters,
 *         pillars, periodPillars }
 * 返回 { added, duplicated, signalDate }。
 */
export async function addWatchlist(items, opts = {}) {
  const list = Array.isArray(items) ? items : [items]
  if (!list.length) return { added: 0, duplicated: [], signalDate: null }

  const signalDate = opts.signalDate || await getSignalDate()
  const maRows = await db.getAll('ma')
  const maMap = {}
  for (const r of maRows) maMap[r.symbol] = r

  const records = []
  const duplicated = []
  for (const it of list) {
    if (!it || !it.symbol) continue
    const id = recordId(signalDate, it.symbol)
    if (await db.get('watchlist', id)) {
      duplicated.push(it.name || it.symbol)
      continue
    }
    const mrow = maMap[it.symbol]
    const entryPrice = it.price != null
      ? Number(it.price)
      : (mrow && mrow.close != null ? Number(mrow.close) : null)
    records.push({
      id,
      signalDate,
      symbol: it.symbol,
      name: it.name || it.symbol,
      entryPrice,
      score: it.score ?? null,
      level: it.level || null,
      reason: it.reason || '',
      stem: it.stem || null,
      stemLabel: it.stemLabel || null,
      godLabel: it.godLabel || null,
      periods: opts.periods || ['monthly', 'weekly', 'daily'],
      filtersLabel: opts.filtersLabel || '自选',
      filters: opts.filters || {},
      pillars: opts.pillars || '',
      periodPillars: opts.periodPillars || [],
      source: it.source === 'auto' || (!it.source && opts.source === 'auto') ? 'auto' : 'manual',
      createdAt: Date.now(),
      status: 'pending',
      nextTradeDate: null,
      exitPrice: null,
      pnlPct: null,
      result: null,
    })
  }
  if (records.length) await db.bulkPut('watchlist', records)
  return { added: records.length, duplicated, signalDate }
}

/** 列出全部记录：信号日倒序、组内分数倒序。 */
export async function listRecords() {
  const rows = await db.getAll('watchlist')
  return rows.sort((a, b) =>
    (a.signalDate < b.signalDate ? 1 : a.signalDate > b.signalDate ? -1 : (b.score || 0) - (a.score || 0)))
}

export function removeRecord(id) {
  return db.del('watchlist', id)
}

// ── 次日结算 ──────────────────────────────────────────────
let _klineCache = new Map()

async function fetchKlines(symbol) {
  if (_klineCache.has(symbol)) return _klineCache.get(symbol)
  const p = import('./market/kline.js')
    .then(({ fetchSymbolKlines }) => fetchSymbolKlines(symbol, 'day'))
    .catch(() => [])
  _klineCache.set(symbol, p)
  return p
}

/**
 * 结算所有到期的 pending 记录（信号日早于最新交易日）。
 * 按票拉取日K（兜底链 + 会话缓存，4 并发）。
 */
export async function settleWatchlist(onProgress = null) {
  const recs = await listRecords()
  const latest = await db.getMeta('ma_trade_date')
  const pending = recs.filter((r) =>
    r.status !== 'settled' && (!latest || r.signalDate < latest))
  if (!pending.length) return { checked: 0, settled: 0, win: 0, lose: 0, flat: 0, noData: 0 }

  const symbols = [...new Set(pending.map((r) => r.symbol))]
  const CONC = 4
  // 先把各票日K拉全（4 并发，会话缓存）
  const klineMap = {}
  let cursor = 0
  const pull = async () => {
    while (cursor < symbols.length) {
      const sym = symbols[cursor++]
      klineMap[sym] = await fetchKlines(sym)
      if (onProgress) onProgress(cursor, symbols.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, symbols.length) }, pull))

  let settled = 0, win = 0, lose = 0, flat = 0, noData = 0
  for (const rec of pending) {
    const upd = evaluateNextBar(rec, klineMap[rec.symbol])
    if (!upd) { noData++; continue }
    await db.put('watchlist', { ...rec, ...upd })
    settled++
    if (upd.result === 'win') win++
    else if (upd.result === 'lose') lose++
    else flat++
  }
  return { checked: pending.length, settled, win, lose, flat, noData }
}

// ── 统计（纯函数，便于测试） ──────────────────────────────
export function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null
}

/** 按信号日分组。 */
export function groupRecords(records) {
  const map = new Map()
  for (const r of records) {
    if (!map.has(r.signalDate)) {
      map.set(r.signalDate, {
        date: r.signalDate, items: [],
        win: 0, lose: 0, flat: 0, pending: 0, pnlSum: 0, settledN: 0,
      })
    }
    const g = map.get(r.signalDate)
    g.items.push(r)
    if (r.status === 'settled') {
      g[r.result] += 1
      g.pnlSum += r.pnlPct || 0
      g.settledN += 1
    } else {
      g.pending += 1
    }
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.items.sort((a, b) => (b.score || 0) - (a.score || 0))
    g.winrate = pct(g.win, g.win + g.lose)
    g.avgPnl = g.settledN ? Math.round((g.pnlSum / g.settledN) * 100) / 100 : null
  }
  return groups.sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** 顶部战绩总览。 */
export function overallStats(records) {
  const settled = records.filter((r) => r.status === 'settled')
  const win = settled.filter((r) => r.result === 'win').length
  const lose = settled.filter((r) => r.result === 'lose').length
  const flat = settled.filter((r) => r.result === 'flat').length
  const avgPnl = settled.length
    ? Math.round((settled.reduce((s, r) => s + (r.pnlPct || 0), 0) / settled.length) * 100) / 100
    : null

  // 连红/连黑：从最近信号日向前，组胜率 >50% 红、<50% 黑，=50% 或未定中断
  let streak = { dir: null, n: 0 }
  for (const g of groupRecords(records)) {
    if (g.win + g.lose === 0) continue
    const dir = g.winrate > 50 ? 'red' : g.winrate < 50 ? 'black' : null
    if (!dir) break
    if (!streak.dir) streak = { dir, n: 1 }
    else if (streak.dir === dir) streak.n += 1
    else break
  }

  // 近 5 个信号日
  const last5 = groupRecords(records).slice(0, 5).reverse().map((g) => ({
    date: g.date, winrate: g.winrate, win: g.win, lose: g.lose, avgPnl: g.avgPnl,
  }))

  return {
    total: records.length, settled: settled.length,
    pending: records.length - settled.length,
    win, lose, flat,
    winrate: pct(win, win + lose),
    avgPnl, streak, last5,
  }
}

/** 一键勾选 vs 手动勾选 分组战绩。 */
export function sourceStats(records) {
  const mk = (source) => {
    const rows = records.filter((r) => r.source === source && r.status === 'settled')
    const win = rows.filter((r) => r.result === 'win').length
    const lose = rows.filter((r) => r.result === 'lose').length
    return {
      source,
      count: records.filter((r) => r.source === source).length,
      settled: rows.length,
      winrate: pct(win, win + lose),
      avgPnl: rows.length
        ? Math.round((rows.reduce((s, r) => s + (r.pnlPct || 0), 0) / rows.length) * 100) / 100
        : null,
    }
  }
  return [mk('auto'), mk('manual')]
}

/** 按入池条件组合分组（只看已结算，样本 <3 标注）。 */
export function conditionStats(records) {
  const map = new Map()
  for (const r of records) {
    if (r.status !== 'settled') continue
    const key = r.filtersLabel || '自选'
    if (!map.has(key)) map.set(key, { label: key, win: 0, lose: 0, flat: 0, pnlSum: 0, n: 0 })
    const g = map.get(key)
    g.n += 1
    g.pnlSum += r.pnlPct || 0
    if (r.result === 'win') g.win += 1
    else if (r.result === 'lose') g.lose += 1
    else g.flat += 1
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      winrate: pct(g.win, g.win + g.lose),
      avgPnl: Math.round((g.pnlSum / g.n) * 100) / 100,
      smallSample: g.n < 3,
    }))
    .sort((a, b) => (b.winrate || 0) - (a.winrate || 0))
}
