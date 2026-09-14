/**
 * 数据同步服务：行情快照 + 144/288 均线日K。
 *
 * 由 server/data_sync.py 的 sync_spot / sync_ma 翻译为前端异步状态机。
 * - 行情快照：fetchSpot() 整表替换 spot 仓库
 * - 均线：从 spot 取 universe，并发拉日K，算 MA 后 bulkPut 到 ma 仓库
 * - 全量后增量：仅拉 tradeDate != 最新交易日的标的
 * - APP 启动自动后台触发（前台异步，不阻塞 UI；切后台由系统暂停 JS 定时器）
 *
 * JS 单线程，用 isSyncing flag 防重入；并发池控制东财 IP 限流。
 */

import * as db from '../storage/db.js'
import { fetchSpot } from './spot.js'
import { fetchKlineEm, fetchSymbolKlines } from './kline.js'
import { computeMaSnapshot } from './ma.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MA_WORKERS = 4 // 并发（过高触发东财 IP 限流断连）

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
const maState = {
  status: 'idle', phase: '', lastError: '',
  done: 0, total: 0, startedAt: '', finishedAt: '',
}
const _metaCache = {}
let _spotCount = 0
let _maCount = 0

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
  _spotCount = await db.count('spot')
  _maCount = await db.count('ma')
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
    // 均线
    maStatus: maState.status,
    maPhase: maState.phase,
    maLastError: maState.lastError,
    maDone: maState.done,
    maTotal: maState.total,
    maTradeDate: _metaCache.ma_trade_date,
    maUpdatedAt: _metaCache.ma_updated_at,
    maCount: _maCount,
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
    // 快照就绪后，若均线未对齐最新交易日，自动触发均线增量同步
    if (_metaCache.ma_trade_date !== dateStr() && rows.length > 0) {
      syncMaAsync(false)
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

// ── 均线同步 ──────────────────────────────────────────────
async function latestTradeDate() {
  /** 取上证指数最新交易日，作为"今日是否已同步"基准。 */
  try {
    const rows = await fetchKlineEm('1.000001')
    return rows.length ? rows[rows.length - 1][0] : null
  } catch (e) {
    return null
  }
}

export async function syncMa(force = false) {
  if (maState.status === 'syncing') return { ok: false, message: '均线同步进行中' }
  maState.status = 'syncing'
  maState.phase = '准备中'
  maState.lastError = ''
  maState.done = 0
  maState.total = 0
  maState.startedAt = now()
  maState.finishedAt = ''
  try {
    let tradeDate = await latestTradeDate()
    if (!tradeDate) tradeDate = _metaCache.ma_trade_date // 限流降级

    const symbols = await db.getAllKeys('spot')
    if (!symbols.length) throw new Error('股票标的为空，请先同步全市场快照')

    const existingRows = await db.getAll('ma')
    const existing = {}
    for (const r of existingRows) existing[r.symbol] = r.tradeDate

    const todo = force
      ? symbols
      : symbols.filter((s) => !tradeDate || existing[s] !== tradeDate)
    const skipped = symbols.length - todo.length

    // 已是目标交易日且覆盖率 >=99% 则跳过
    if (!force && tradeDate && _metaCache.ma_trade_date === tradeDate) {
      const coverage = 1 - todo.length / symbols.length
      if (coverage >= 0.99) {
        maState.status = 'idle'
        maState.phase = ''
        maState.finishedAt = now()
        return { ok: true, skipped: true, message: `均线数据已为最新（${tradeDate}，${symbols.length}只）` }
      }
    }

    maState.phase = '拉取日K中'
    maState.total = symbols.length
    maState.done = skipped

    const records = []
    const failedSyms = []

    // 并发池
    let idx = 0
    const worker = async () => {
      while (idx < todo.length) {
        const sym = todo[idx++]
        try {
          const klines = await fetchSymbolKlines(sym)
          const snap = computeMaSnapshot(sym, klines)
          if (snap) {
            snap.source = 'em'
            records.push(snap)
          } else {
            failedSyms.push(sym) // 次新股 <144 根，不算错误
          }
        } catch (e) {
          failedSyms.push(sym)
        }
        maState.done++
        if (maState.done % 100 === 0) {
          maState.phase = `拉取日K中 ${maState.done}/${maState.total}`
        }
      }
    }
    await Promise.all(
      Array.from({ length: MA_WORKERS }, () => worker()),
    )

    // 持久化（逐轮落库，限流中断也不丢进度）
    if (records.length) {
      maState.phase = `写库中(${records.length}只)`
      await db.bulkPut('ma', records)
      const eff = tradeDate ||
        records.reduce((m, r) => (r.tradeDate > m ? r.tradeDate : m), '')
      await setMetaCached('ma_trade_date', eff)
      await setMetaCached('ma_updated_at', `${dateStr()} ${now()}`)
      _maCount = await db.count('ma')
    }

    // 限流失败：短冷却后补拉一轮（前端不宜过长冷却，剩余可手动再点）
    const got = new Set(records.map((r) => r.symbol))
    const stillMissing = failedSyms.filter((s) => !got.has(s))
    if (stillMissing.length && records.length) {
      maState.phase = `冷却60s后补拉重试（${stillMissing.length}只）`
      await sleep(60000)
      let idx2 = 0
      const w2 = async () => {
        while (idx2 < stillMissing.length) {
          const sym = stillMissing[idx2++]
          try {
            const klines = await fetchSymbolKlines(sym)
            const snap = computeMaSnapshot(sym, klines)
            if (snap) {
              snap.source = 'em'
              records.push(snap)
            }
          } catch (e) {
            // 忽略，剩余可再手动补
          }
          maState.done++
        }
      }
      await Promise.all(Array.from({ length: 2 }, () => w2()))
      if (records.length) {
        await db.bulkPut('ma', records.filter((r) => stillMissing.includes(r.symbol) || true))
        _maCount = await db.count('ma')
      }
    }

    if (!records.length) {
      throw new Error('未获取到任何有效日K（数据源全部失败/限流中，请稍后重试）')
    }
    const effDate =
      tradeDate ||
      records.reduce((m, r) => (r.tradeDate > m ? r.tradeDate : m), '')
    maState.status = 'idle'
    maState.phase = ''
    maState.done = _maCount
    maState.finishedAt = now()
    let msg = `均线同步完成：累计${_maCount}只（交易日 ${effDate}）`
    if (failedSyms.length) {
      msg += `，${failedSyms.length}只无有效日K（次新股/退市/源失败，可再点更新补齐）`
    }
    return {
      ok: true, message: msg, count: _maCount,
      tradeDate: effDate, updated: records.length, failed: failedSyms.length,
    }
  } catch (e) {
    maState.status = 'failed'
    maState.phase = ''
    maState.lastError = String(e)
    maState.finishedAt = now()
    return { ok: false, message: `均线同步失败：${e}` }
  }
}

/** 后台触发均线同步（force=true 强制全量重拉）。 */
export function syncMaAsync(force = false) {
  if (maState.status === 'syncing') return { ok: false, message: '均线同步进行中' }
  syncMa(force) // 不 await，后台执行
  return { ok: true, message: '已启动均线后台同步' }
}

/**
 * APP 启动自动同步：当日快照未拉则后台拉快照；
 * 快照就绪后若均线未对齐最新交易日则后台拉均线（首次全量，之后增量）。
 * 在 APP 挂载时调用，不阻塞 UI。
 */
export async function autoSyncOnStartup() {
  await loadMeta()
  // 行情快照：当日未同步则后台拉
  if (_metaCache.last_success_date !== dateStr()) {
    syncSpotAsync()
  } else if (_spotCount > 0 && _metaCache.ma_trade_date !== dateStr()) {
    // 快照已最新但均线未对齐今日，触发均线增量
    syncMaAsync(false)
  }
}
