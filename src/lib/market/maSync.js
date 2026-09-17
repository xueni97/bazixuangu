/**
 * 数据同步服务：行情快照 + 144/288 日均线K + 144/288 周均线K。
 *
 * - 行情快照：fetchSpot() 整表替换 spot 仓库
 * - 日均线(period=day)：从 spot 取 universe，并发拉日K，算 MA 后写 ma 仓库
 * - 周均线(period=week)：同理拉周K，写 maWeek 仓库（144/288 交易周长周期）
 * - 全量后增量：仅拉 tradeDate != 最新交易日/周的标的
 * - APP 启动自动后台触发，串行链 快照→日MA→周MA（避免双 MA 池并发触发限流）
 *
 * JS 单线程，用 status flag 防重入；并发池控制数据源 IP 限流。
 */

import * as db from '../storage/db.js'
import { fetchSpot } from './spot.js'
import { fetchSymbolKlines, fetchIndexKlines } from './kline.js'
import { computeMaSnapshot } from './ma.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MA_WORKERS = 4 // 并发（过高触发数据源 IP 限流断连）

const p = (n) => String(n).padStart(2, '0')
function now() {
  const d = new Date()
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function dateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── 内存态 ──
const spotState = {
  status: 'idle', phase: '', lastError: '',
  startedAt: '', finishedAt: '',
}
function makeMaState() {
  return {
    status: 'idle', phase: '', lastError: '',
    done: 0, total: 0, startedAt: '', finishedAt: '',
  }
}
const maState = makeMaState()       // 日均线
const maWeekState = makeMaState()   // 周均线

// 周期配置：存储仓库 / 状态 / meta 键 / 文案
const MA_CFG = {
  day: {
    store: 'ma', state: maState,
    dateKey: 'ma_trade_date', atKey: 'ma_updated_at',
    label: '日均线', klineLabel: '日K',
  },
  week: {
    store: 'maWeek', state: maWeekState,
    dateKey: 'ma_week_trade_date', atKey: 'ma_week_updated_at',
    label: '周均线', klineLabel: '周K',
  },
}

const _metaCache = {}
let _spotCount = 0
let _maCount = 0
let _maWeekCount = 0

async function setMetaCached(key, value) {
  _metaCache[key] = value
  await db.setMeta(key, value)
}

/** 启动时加载元信息与计数到内存缓存（供 getSyncState 同步返回）。 */
export async function loadMeta() {
  _metaCache.last_success_date = await db.getMeta('last_success_date')
  _metaCache.last_source = await db.getMeta('last_source')
  _metaCache.ma_trade_date = await db.getMeta('ma_trade_date')
  _metaCache.ma_updated_at = await db.getMeta('ma_updated_at')
  _metaCache.ma_week_trade_date = await db.getMeta('ma_week_trade_date')
  _metaCache.ma_week_updated_at = await db.getMeta('ma_week_updated_at')
  _spotCount = await db.count('spot')
  _maCount = await db.count('ma')
  _maWeekCount = await db.count('maWeek')
}

/** 同步状态（前端轮询用，字段 camelCase）。 */
export function getSyncState() {
  return {
    // 行情快照
    spotStatus: spotState.status,
    spotPhase: spotState.phase,
    spotLastError: spotState.lastError,
    lastSuccessDate: _metaCache.last_success_date,
    todaySynced: _metaCache.last_success_date === dateStr(),
    spotCount: _spotCount,
    lastSource: _metaCache.last_source,
    // 日均线
    maStatus: maState.status,
    maPhase: maState.phase,
    maLastError: maState.lastError,
    maDone: maState.done,
    maTotal: maState.total,
    maTradeDate: _metaCache.ma_trade_date,
    maUpdatedAt: _metaCache.ma_updated_at,
    maCount: _maCount,
    // 周均线
    maWeekStatus: maWeekState.status,
    maWeekPhase: maWeekState.phase,
    maWeekLastError: maWeekState.lastError,
    maWeekDone: maWeekState.done,
    maWeekTotal: maWeekState.total,
    maWeekTradeDate: _metaCache.ma_week_trade_date,
    maWeekUpdatedAt: _metaCache.ma_week_updated_at,
    maWeekCount: _maWeekCount,
  }
}

// ── 行情快照同步 ──────────────────────────────────────────
export async function syncSpot() {
  if (spotState.status === 'syncing') return { ok: false, message: '同步进行中' }
  spotState.status = 'syncing'
  spotState.phase = '拉取中'
  spotState.lastError = ''
  spotState.startedAt = now()
  spotState.finishedAt = ''
  try {
    const { rows, source } = await fetchSpot()
    spotState.phase = `写库中(${rows.length}只)`
    await db.replaceAll('spot', rows)
    await setMetaCached('last_success_date', dateStr())
    await setMetaCached('last_source', source)
    _spotCount = rows.length
    spotState.status = 'idle'
    spotState.phase = ''
    spotState.finishedAt = now()
    // 快照就绪后串行链：日均线落后则同步，完成后再检查周均线
    if (rows.length > 0) {
      chainMaAfterSpot('day')
    }
    return { ok: true, message: `同步成功(${source})，共${rows.length}只` }
  } catch (e) {
    spotState.status = 'failed'
    spotState.phase = ''
    spotState.lastError = String(e)
    spotState.finishedAt = now()
    return { ok: false, message: `同步失败：${e}` }
  }
}

/** 后台触发快照同步（不阻塞调用方）。 */
export function syncSpotAsync() {
  if (spotState.status === 'syncing') return { ok: false, message: '同步进行中' }
  if (_metaCache.last_success_date === dateStr()) {
    return { ok: true, message: '今日快照已是最新', skipped: true }
  }
  syncSpot() // 不 await，后台执行
  return { ok: true, message: '已启动后台同步' }
}

// ── 均线同步（日/周通用） ─────────────────────────────────
/**
 * 取上证指数最新 K 线日期作为增量基准（日=最新交易日，周=最新交易周）。
 * 统一走 kline.js 的多源链：BaoStock sh.000001 → 东财 → 腾讯 → 新浪。
 */
async function latestTradeDate(period) {
  try {
    const rows = await fetchIndexKlines(period)
    if (rows.length) return rows[rows.length - 1][0]
  } catch (e) {
    // 全部失败
  }
  return null
}

/**
 * 通用均线同步。
 * @param {'day'|'week'} period
 * @param {boolean} force true=全量重拉；false=增量（只拉落后标的）
 */
export async function syncMa(period = 'day', force = false) {
  const cfg = MA_CFG[period]
  const st = cfg.state
  if (st.status === 'syncing') return { ok: false, message: `${cfg.label}同步进行中` }
  st.status = 'syncing'
  st.phase = '准备中'
  st.lastError = ''
  st.done = 0
  st.total = 0
  st.startedAt = now()
  st.finishedAt = ''
  try {
    let tradeDate = await latestTradeDate(period)
    if (!tradeDate) tradeDate = _metaCache[cfg.dateKey] // 全源限流降级

    const symbols = await db.getAllKeys('spot')
    if (!symbols.length) throw new Error('股票标的为空，请先同步全市场快照')

    const existingRows = await db.getAll(cfg.store)
    const existing = {}
    for (const r of existingRows) existing[r.symbol] = r.tradeDate

    const todo = force
      ? symbols
      : symbols.filter((s) => !tradeDate || existing[s] !== tradeDate)
    const skipped = symbols.length - todo.length

    // 已是目标日期且覆盖率 >=99% 则跳过
    if (!force && tradeDate && _metaCache[cfg.dateKey] === tradeDate) {
      const coverage = 1 - todo.length / symbols.length
      if (coverage >= 0.99) {
        st.status = 'idle'
        st.phase = ''
        st.finishedAt = now()
        return { ok: true, skipped: true, message: `${cfg.label}数据已为最新（${tradeDate}，${symbols.length}只）` }
      }
    }

    st.phase = `拉取${cfg.klineLabel}中`
    st.total = symbols.length
    st.done = skipped

    const records = []
    const failedSyms = []

    // 并发池
    let idx = 0
    const worker = async () => {
      while (idx < todo.length) {
        const sym = todo[idx++]
        try {
          const klines = await fetchSymbolKlines(sym, period)
          const snap = computeMaSnapshot(sym, klines)
          if (snap) {
            snap.source = 'multi'
            records.push(snap)
          } else {
            failedSyms.push(sym) // 次新股 <144 根，不算错误
          }
        } catch (e) {
          failedSyms.push(sym)
        }
        st.done++
        if (st.done % 100 === 0) {
          st.phase = `拉取${cfg.klineLabel}中 ${st.done}/${st.total}`
        }
      }
    }
    await Promise.all(
      Array.from({ length: MA_WORKERS }, () => worker()),
    )

    // 持久化（逐轮落库，限流中断也不丢进度）
    if (records.length) {
      st.phase = `写库中(${records.length}只)`
      await db.bulkPut(cfg.store, records)
      const eff = tradeDate ||
        records.reduce((m, r) => (r.tradeDate > m ? r.tradeDate : m), '')
      await setMetaCached(cfg.dateKey, eff)
      await setMetaCached(cfg.atKey, `${dateStr()} ${now()}`)
      if (period === 'day') _maCount = await db.count('ma')
      else _maWeekCount = await db.count('maWeek')
    }

    // 限流失败：短冷却后补拉一轮（只补缺失项，不再重复全量）
    const got = new Set(records.map((r) => r.symbol))
    const stillMissing = failedSyms.filter((s) => !got.has(s))
    if (stillMissing.length && records.length) {
      st.phase = `冷却60s后补拉重试（${stillMissing.length}只）`
      await sleep(60000)
      const retryRecords = []
      let idx2 = 0
      const w2 = async () => {
        while (idx2 < stillMissing.length) {
          const sym = stillMissing[idx2++]
          try {
            const klines = await fetchSymbolKlines(sym, period)
            const snap = computeMaSnapshot(sym, klines)
            if (snap) retryRecords.push(snap)
          } catch (e) {
            // 忽略，剩余可再手动补
          }
        }
      }
      await Promise.all(Array.from({ length: 2 }, () => w2()))
      if (retryRecords.length) {
        await db.bulkPut(cfg.store, retryRecords)
        if (period === 'day') _maCount = await db.count('ma')
        else _maWeekCount = await db.count('maWeek')
      }
    }

    if (!records.length) {
      throw new Error(`未获取到任何有效${cfg.klineLabel}（数据源全部失败/限流中，请稍后重试）`)
    }
    const effDate =
      tradeDate ||
      records.reduce((m, r) => (r.tradeDate > m ? r.tradeDate : m), '')
    const totalCount = period === 'day' ? _maCount : _maWeekCount
    st.status = 'idle'
    st.phase = ''
    st.done = totalCount
    st.finishedAt = now()
    let msg = `${cfg.label}同步完成：累计${totalCount}只（${period === 'week' ? '交易周' : '交易日'} ${effDate}）`
    if (failedSyms.length) {
      msg += `，${failedSyms.length}只无有效${cfg.klineLabel}（次新股/退市/源失败，可再点更新补齐）`
    }
    return {
      ok: true, message, count: totalCount,
      tradeDate: effDate, updated: records.length, failed: failedSyms.length,
    }
  } catch (e) {
    st.status = 'failed'
    st.phase = ''
    st.lastError = String(e)
    st.finishedAt = now()
    return { ok: false, message: `${cfg.label}同步失败：${e}` }
  }
}

/** 后台触发均线同步。period 'day'/'week'，force=true 强制全量重拉。 */
export function syncMaAsync(period = 'day', force = false) {
  const cfg = MA_CFG[period]
  if (cfg.state.status === 'syncing') return { ok: false, message: `${cfg.label}同步进行中` }
  syncMa(period, force) // 不 await，后台执行
  return { ok: true, message: `已启动${cfg.label}后台同步` }
}

/**
 * 快照完成后串行推进均线链：day → week。
 * 仅当 meta 落后时触发，保证日/周均线不同时并发（防限流）。
 */
async function chainMaAfterSpot(period) {
  if (period === 'day') {
    if (_metaCache.ma_trade_date !== dateStr() || _maCount < _spotCount * 0.99) {
      const r = await syncMa('day', false)
      // 日线完成/跳过/已最新后，衔接周线检查
      if (r.ok) chainMaAfterSpot('week')
    } else {
      chainMaAfterSpot('week')
    }
  } else if (period === 'week') {
    // 周线增量基准是"最新交易周"，未知时同步一次即可；每周首次启动全量/增量
    const latest = await latestTradeDate('week')
    const need = !latest || _metaCache.ma_week_trade_date !== latest
    if (need) await syncMa('week', false)
  }
}

/**
 * APP 启动自动同步（串行链）：
 * 当日快照未拉 → 后台拉快照（完成后自动推进日/周均线）；
 * 快照已最新 → 检查日均线 → 再检查周均线。
 * 在 APP 挂载时调用，不阻塞 UI。
 */
export async function autoSyncOnStartup() {
  await loadMeta()
  if (_metaCache.last_success_date !== dateStr()) {
    syncSpotAsync()
    return
  }
  // 快照已最新：日均线落后则先跑日线（其内部完成后不自动接周线，故此处串行调度）
  if (_spotCount > 0 && (_metaCache.ma_trade_date !== dateStr() || _maCount < _spotCount * 0.99)) {
    const r = await syncMa('day', false)
    if (r.ok) chainMaAfterSpot('week')
  } else {
    chainMaAfterSpot('week')
  }
}
