/**
 * 本地化 API 层：直接调用命理引擎 + IndexedDB 数据层 + 同步服务。
 *
 * 移除 axios / 局域网后端依赖，APP 独立运行：
 * - scanStocks：从 db.spot 取 universe，本地评分（lib/metaphysics 引擎）
 * - searchStocks：本地 LIKE 搜索 + 本地评分（结果带 element/score/level/reason/periodScores）
 * - getSectors：本地按五行分组计数
 * - getSyncStatus / triggerSync / triggerMaSync：转发到 maSync 同步服务
 *
 * 响应字段与原 Python 后端 /api/* 保持一致，ScanPage 无需改契约。
 * 原后端 snake_case 字段（如 ma_trade_date）在 getSyncStatus 中由 maSync.getSyncState()
 * 返回 camelCase；ScanPage 已适配 camelCase。
 */

import * as db from '../lib/storage/db.js'
import {
  syncSpotAsync, syncMaAsync, getSyncState, loadMeta,
} from '../lib/market/maSync.js'
import { nearMa, classifyMarket } from '../lib/market/ma.js'
import { StockElementAnalyzer } from '../lib/metaphysics/stockElement.js'
import { YuanhaiDecisionModel } from '../lib/metaphysics/model.js'

const PERIOD_LABELS = { monthly: '月', weekly: '周', daily: '日' }
const PERIOD_WEIGHTS = { monthly: 0.5, weekly: 0.3, daily: 0.2 }
const VALID_ELEMS = new Set(['木', '火', '土', '金', '水'])

function pad2(n) { return String(n).padStart(2, '0') }
function fmtDateTime(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ` +
    `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
}

/** 获取股票名称列表（全量，从行情快照取）。 */
export async function getStockNames() {
  const rows = await db.getAll('spot')
  return rows.map((r) => ({ symbol: r.symbol, name: r.name }))
}

/**
 * 全市场命理扫描，按多周期综合评分排序。
 * 参数键名与原后端 snake_case 对齐（periods/elements/markets/min_price/max_price/ma/ma_tol/min_score/limit）。
 */
export async function scanStocks(params = {}) {
  const p = params || {}
  const now = new Date()

  // 周期勾选（保持月→周→日顺序）
  const rawPeriods = String(p.periods || 'daily')
  const selected = ['monthly', 'weekly', 'daily'].filter(
    (k) => rawPeriods.split(',').includes(k),
  ) || ['daily']

  // 均线附加指标
  const maWindows = []
  for (const w of String(p.ma || '').split(',')) {
    const n = parseInt(w, 10)
    if ((n === 144 || n === 288) && !maWindows.includes(n)) maWindows.push(n)
  }
  let maTol = parseFloat(p.ma_tol)
  if (Number.isNaN(maTol)) maTol = 0.03
  maTol = Math.min(0.1, Math.max(0.005, maTol))

  // 属性/市场/价格筛选
  const elemFilter = new Set(
    String(p.elements || '').split(',').map((s) => s.trim()).filter(Boolean),
  )
  const marketFilter = new Set(
    String(p.markets || '').split(',').map((s) => s.trim()).filter(Boolean),
  )
  const minPrice = p.min_price !== '' && p.min_price != null ? parseFloat(p.min_price) : null
  const maxPrice = p.max_price !== '' && p.max_price != null ? parseFloat(p.max_price) : null
  const minScore = parseInt(p.min_score, 10) || 10
  const limit = parseInt(p.limit, 10) || 100

  // 周期分析（一次计算）
  const periodData = YuanhaiDecisionModel.periodAnalyses(now)
  const dailyAnalysis = periodData.daily.analysis

  // 各周期元信息
  const periodMeta = []
  for (const k of ['monthly', 'weekly', 'daily']) {
    if (!selected.includes(k)) continue
    const pd = periodData[k]
    const an = pd.analysis
    periodMeta.push({
      key: k,
      label: PERIOD_LABELS[k],
      weight: PERIOD_WEIGHTS[k],
      date: pd.date,
      pillars: String(pd.pillars),
      dayMaster: an.dayMaster,
      dayMasterStrength: an.dayMasterStrength,
      useGods: an.useGods,
      avoidGods: an.avoidGods,
    })
  }

  // universe：从 IndexedDB spot 仓库取
  const spotRows = await db.getAll('spot')
  if (!spotRows.length) {
    throw new Error('本地行情快照为空：请先点「更新数据」同步全市场快照')
  }

  // 均线表
  const maRows = await db.getAll('ma')
  const maMap = {}
  for (const r of maRows) maMap[r.symbol] = r
  const maTradeDate = await db.getMeta('ma_trade_date')
  if (maWindows.length && !maTradeDate) {
    const err = new Error('均线指标尚未同步：请先点「更新均线(144/288)」完成日K同步（首次约3~5分钟）')
    err.code = 'MA_NOT_SYNCED'
    throw err
  }

  const results = []
  for (const row of spotRows) {
    const symbol = row.symbol
    const name = row.name || symbol
    const price = row.price ?? null
    const changePct = row.changePct ?? null
    const market = row.market || classifyMarket(symbol)

    // 硬过滤：市场
    if (marketFilter.size && !marketFilter.has(market)) continue
    // 硬过滤：价格
    if (price != null) {
      if (minPrice != null && price < minPrice) continue
      if (maxPrice != null && price > maxPrice) continue
    }

    // 五行属性
    const elem = StockElementAnalyzer.combinedElement(name)
    if (!elem) continue
    if (elemFilter.size && !elemFilter.has(elem)) continue

    // 硬过滤：回踩 144/288 日均线附近
    const mrow = maMap[symbol]
    let refPrice = price
    let ma144 = null, ma288 = null, high20 = null, kclose = null, maDate = null
    if (mrow) {
      maDate = mrow.tradeDate
      kclose = mrow.close
      high20 = mrow.high20
      ma144 = mrow.ma144
      ma288 = mrow.ma288
      if (refPrice == null) refPrice = kclose
    }
    if (maWindows.length) {
      if (!mrow) continue
      let maHit = true
      for (const w of maWindows) {
        const maVal = w === 144 ? ma144 : ma288
        const [hit] = nearMa(refPrice, maVal, high20, maTol)
        if (!hit) { maHit = false; break }
      }
      if (!maHit) continue
    }

    // 综合评分
    const info = YuanhaiDecisionModel.compositeScore(elem, periodData, selected, name)
    if (info.score < minScore) continue

    const item = {
      symbol, name, element: elem,
      score: info.score, level: info.level, reason: info.reason,
      periodScores: Object.fromEntries(
        Object.entries(info.periodScores).map(([k, v]) => [k, { score: v.score, level: v.level }]),
      ),
      price, changePct, market,
    }
    // 均线附加信息（有则带，供前端展示距离标签，不依赖勾选）
    if (mrow) {
      item.maDate = maDate
      if (ma144) {
        const [, d144] = nearMa(refPrice, ma144, high20, 1.0)
        item.ma144 = ma144
        item.dist144 = d144
      }
      if (ma288) {
        const [, d288] = nearMa(refPrice, ma288, high20, 1.0)
        item.ma288 = ma288
        item.dist288 = d288
      }
    }
    results.push(item)
  }

  results.sort((a, b) => b.score - a.score)
  const trimmed = results.slice(0, limit)

  return {
    date: fmtDateTime(now),
    pillars: String(periodData.daily.pillars),
    dayMaster: dailyAnalysis.dayMaster,
    dayMasterElement: dailyAnalysis.dayMasterElement,
    dayMasterStrength: dailyAnalysis.dayMasterStrength,
    useGods: dailyAnalysis.useGods,
    avoidGods: dailyAnalysis.avoidGods,
    toneGod: dailyAnalysis.toneGod,
    periods: periodMeta,
    maFilter: maWindows,
    maTol,
    maTradeDate,
    dataSource: 'spot',
    totalScanned: spotRows.length,
    totalMatched: trimmed.length,
    results: trimmed,
  }
}

/**
 * 搜索股票（按代码或名称，本地 LIKE）。
 * 返回带评分的结果：{symbol, name, price, changePct, element, score, level, reason, periodScores}。
 * 搜索不做属性硬过滤，仅评分展示（与原 ScanPage.onSearch 本地评分行为一致）。
 */
export async function searchStocks(keyword, periods = ['monthly', 'weekly', 'daily']) {
  const q = String(keyword || '').trim()
  if (!q) return []
  const rows = await db.getAll('spot')
  const lower = q.toLowerCase()
  const matched = rows.filter((r) =>
    r.symbol.includes(q) || (r.name && r.name.toLowerCase().includes(lower)),
  ).slice(0, 20)

  if (!matched.length) return []

  const periodData = YuanhaiDecisionModel.periodAnalyses(new Date())
  return matched.map((s) => {
    const elem = StockElementAnalyzer.combinedElement(s.name)
    const info = YuanhaiDecisionModel.compositeScore(elem, periodData, periods, s.name)
    return {
      symbol: s.symbol, name: s.name,
      price: s.price ?? null, changePct: s.changePct ?? null,
      market: s.market || classifyMarket(s.symbol),
      element: elem, score: info.score, level: info.level,
      reason: info.reason, periodScores: info.periodScores,
    }
  })
}

/** 获取五行分布统计（全 universe 按五行分组计数，按日缓存）。 */
let _sectorsCache = { date: '', data: null }
export async function getSectors() {
  const today = `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-${pad2(new Date().getDate())}`
  if (_sectorsCache.date === today && _sectorsCache.data) return _sectorsCache.data

  const rows = await db.getAll('spot')
  const counts = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0, 未知: 0 }
  for (const r of rows) {
    const elem = StockElementAnalyzer.combinedElement(r.name || r.symbol)
    counts[elem || '未知'] += 1
  }
  _sectorsCache = { date: today, data: counts }
  return counts
}

/**
 * 获取同步状态（camelCase，字段与 maSync.getSyncState 对齐）。
 * ScanPage.refreshSyncStatus 据此判断 syncing/maSyncing。
 */
export async function getSyncStatus() {
  // 确保元信息已加载到内存（首次调用时）
  await loadMeta()
  return getSyncState()
}

/** 手动触发全市场快照同步（后台执行）。 */
export async function triggerSync() {
  return syncSpotAsync()
}

/** 手动触发 144/288 日均线日K同步（force=true 强制重拉当日）。 */
export async function triggerMaSync(force = false) {
  return syncMaAsync(force)
}
