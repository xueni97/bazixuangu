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

const MA_WORKERS = 4 // 并发（过高触发数据源 IP 限流断连）
// 覆盖率达标线：全市场天然存在次新股(<144根)/停牌/退市等无效标的，不可能100%有均线，
// 达到 90% 即视为数据完整（失败票仍可手动点更新或下个交易日增量补齐）
const COV_OK = 0.9

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
// 数据源二选一（由 .env 的 VITE_DATA_SOURCE 控制）：
//   server = 走服务器 API（cron 已用 baostock 拉好入库，稳定不卡死）
//   local  = 浏览器直连东财/新浪兜底链（无服务器时用，受数据源限流影响）
const DATA_SOURCE = ((import.meta.env && import.meta.env.VITE_DATA_SOURCE) || 'local').toLowerCase()
const API_BASE = DATA_SOURCE === 'server'
  ? ((import.meta.env && import.meta.env.VITE_API_BASE) || '')
  : ''

export async function syncSpot() {
  if (spotState.status === 'syncing') return { ok: false, message: '同步进行中' }
  spotState.status = 'syncing'
  spotState.phase = '拉取中'
  spotState.lastError = ''
  spotState.startedAt = now()
  spotState.finishedAt = ''
  try {
    let rows, source
    if (API_BASE) {
      // 服务器部署模式：触发服务器端同步（baostock 主源，稳定）→ 轮询完成 → 读库
      spotState.phase = '服务器同步中'
      const t = await fetch(`${API_BASE}/api/sync`, { method: 'POST' })
      if (!t.ok && t.status !== 409) throw new Error(`服务器同步触发 HTTP ${t.status}`)
      const deadline = Date.now() + 120000 // 服务器 spot 一次 HTTP 全市场拉取，通常 30s 内
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = await (await fetch(`${API_BASE}/api/sync/status`)).json()
        if (st.status !== 'syncing') break
      }
      spotState.phase = '服务器读取中'
      const resp = await fetch(`${API_BASE}/api/spot`)
      if (!resp.ok) throw new Error(`服务器快照接口 HTTP ${resp.status}`)
      const d = await resp.json()
      rows = d.rows || []
      source = d.source || 'server-db'
      if (!rows.length) throw new Error('服务器快照为空，请先在服务器跑 sync_once.py')
    } else {
      ;({ rows, source } = await fetchSpot())
    }
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
      chainMaAfterSpot('day').catch((e) => { spotState.lastError = String(e) })
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

/** 某周期均线是否需要同步：基准为指数最新交易日/周（非今天日期），覆盖率 <90% 也算落后。 */
async function maNeedSync(period) {
  if (!_spotCount) return false
  const cfg = MA_CFG[period]
  const count = period === 'day' ? _maCount : _maWeekCount
  if (count < _spotCount * COV_OK) return true
  const latest = await latestTradeDate(period)
  // 指数取数全挂（断网/限流）时不盲目触发全量，等网络恢复后的下次启动
  if (!latest) return false
  return _metaCache[cfg.dateKey] !== latest
}

const FLUSH_BATCH = 40 // 每 40 只立即落库一批：中断/杀进程后已拉取进度不丢

/**
 * 通用均线同步（增量 + 断点续传）。
 * @param {'day'|'week'} period
 * @param {boolean} force true=全量重拉；false=增量（只拉 tradeDate 落后于最新交易日/周的标的）
 *
 * 增量水位 = 个股记录的 tradeDate。每 FLUSH_BATCH 只批量落库一次，
 * 因此中途退出/刷新后重启，已对齐最新交易日的票自动排除在 todo 之外，绝不重拉。
 */
export async function syncMa(period = 'day', force = false) {
  const cfg = MA_CFG[period]
  const st = cfg.state
  if (st.status === 'syncing') return { ok: false, message: `${cfg.label}同步进行中` }
  // 跨周期互斥：日/周同时并发会导致 8 连接打爆数据源；自动链会在当前周期完成后续跑另一周期
  const otherPeriod = period === 'day' ? 'week' : 'day'
  if (MA_CFG[otherPeriod].state.status === 'syncing') {
    return { ok: false, message: `请等待${MA_CFG[otherPeriod].label}同步完成后再更新${cfg.label}（自动排队，无需重复点击）` }
  }
  st.status = 'syncing'
  st.phase = '准备中'
  st.lastError = ''
  st.done = 0
  st.total = 0
  st.startedAt = now()
  st.finishedAt = ''
  const barUnit = period === 'week' ? '交易周' : '交易日'
  try {
    let tradeDate = await latestTradeDate(period)
    if (!tradeDate) tradeDate = _metaCache[cfg.dateKey] // 指数全源失败时沿用旧水位

    const symbols = await db.getAllKeys('spot')
    if (!symbols.length) throw new Error('股票标的为空，请先同步全市场快照')

    const existingRows = await db.getAll(cfg.store)
    const existing = {}
    for (const r of existingRows) existing[r.symbol] = r.tradeDate

    const todo = force
      ? symbols
      : symbols.filter((s) => !tradeDate || existing[s] !== tradeDate)
    const skipped = symbols.length - todo.length

    // 已全部对齐：校正 meta 后直接跳过（同一天/同一交易周反复刷新不再重拉）
    if (!todo.length) {
      if (tradeDate && _metaCache[cfg.dateKey] !== tradeDate) {
        await setMetaCached(cfg.dateKey, tradeDate)
        await setMetaCached(cfg.atKey, `${dateStr()} ${now()}`)
      }
      st.status = 'idle'
      st.phase = ''
      st.finishedAt = now()
      return { ok: true, skipped: true, message: `${cfg.label}已为最新（${tradeDate || '?'}，${symbols.length}只）` }
    }
    // 增量模式下水位已对齐且覆盖率达标，跳过缺口（次新股/停牌/退市）
    if (!force && tradeDate && _metaCache[cfg.dateKey] === tradeDate && skipped / symbols.length >= COV_OK) {
      st.status = 'idle'
      st.phase = ''
      st.finishedAt = now()
      return { ok: true, skipped: true, message: `${cfg.label}已为最新（${tradeDate}，${symbols.length}只）` }
    }

    // 进度只统计实际待拉数量（而非全市场 5916），避免"每次都像全量"的错觉
    st.total = todo.length
    st.done = 0
    st.phase = `拉取${cfg.klineLabel} 0/${todo.length}（跳过${skipped}只最新）`

    const failedSyms = []
    let written = 0

    // 并发池；每个 worker 用本地 buffer 分批落库（断点续传）
    // 日K周期同步把原始K线一并写入 kline 仓库，回测引擎直接读库不再拉网络
    const cacheKline = period === 'day'
    let idx = 0
    const worker = async () => {
      const local = []
      const klineLocal = []
      const flushLocal = async () => {
        if (!local.length && !klineLocal.length) return 0
        const batch = local.splice(0, local.length)
        const klineBatch = klineLocal.splice(0, klineLocal.length)
        const jobs = []
        if (batch.length) jobs.push(db.bulkPut(cfg.store, batch))
        if (klineBatch.length) jobs.push(db.bulkPut('kline', klineBatch))
        await Promise.all(jobs)
        written += batch.length
        return batch.length
      }
      while (idx < todo.length) {
        const sym = todo[idx++]
        try {
          const klines = await fetchSymbolKlines(sym, period)
          if (!klines.length) {
            failedSyms.push(sym) // 源全失败/限流：稍后冷却补拉
          } else {
            const snap = computeMaSnapshot(sym, klines)
            if (snap) {
              snap.source = 'multi'
              local.push(snap)
            }
            // snap=null 为次新股（<144 根K线），属正常情况，不补拉
            // 原始日K即便次新股也缓存（回测候选可能用到）
            if (cacheKline && klines.length) {
              klineLocal.push({
                symbol: sym,
                bars: klines,
                tradeDate: klines[klines.length - 1][0],
                barsCount: klines.length,
                updatedAt: Date.now(),
              })
            }
            if (local.length >= FLUSH_BATCH || klineLocal.length >= FLUSH_BATCH) {
              await flushLocal()
            }
          }
        } catch (e) {
          failedSyms.push(sym)
        }
        st.done++
        if (st.done % 50 === 0 || st.done === st.total) {
          st.phase = `拉取${cfg.klineLabel} ${st.done}/${st.total}（跳过${skipped}只）`
        }
      }
      await flushLocal()
    }
    await Promise.all(
      Array.from({ length: MA_WORKERS }, () => worker()),
    )

    if (!written) {
      throw new Error(`未获取到任何有效${cfg.klineLabel}（数据源全部失败/限流中，请稍后重试）`)
    }

    // 水位与计数（个股记录已分批落库，此处只写 meta）
    st.phase = '收尾中'
    const effDate = tradeDate
    await setMetaCached(cfg.dateKey, effDate)
    await setMetaCached(cfg.atKey, `${dateStr()} ${now()}`)
    const totalCount = await db.count(cfg.store)
    if (period === 'day') _maCount = totalCount
    else _maWeekCount = totalCount

    // 失败票不做集中补拉（旧逻辑 sleep 60s + 串行补拉会长时间卡住并阻塞周线）：
    // 这些票未写 tradeDate，天然留在增量 todo 中，下次启动/手动更新自动补齐。
    const remainFailed = failedSyms.length

    const finalCount = await db.count(cfg.store)
    if (period === 'day') _maCount = finalCount
    else _maWeekCount = finalCount
    st.status = 'idle'
    st.phase = ''
    st.done = st.total
    st.finishedAt = now()
    let msg = `${cfg.label}同步完成：新增/更新${written}只，累计${finalCount}只（${barUnit} ${effDate}）`
    if (remainFailed > 0) {
      msg += `，${remainFailed}只源失败（下次打开自动补，也可再点更新）`
    }
    return {
      ok: true, message: msg, count: finalCount,
      tradeDate: effDate, updated: written, skipped, failed: remainFailed,
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
  const otherPeriod = period === 'day' ? 'week' : 'day'
  if (MA_CFG[otherPeriod].state.status === 'syncing') {
    return { ok: false, message: `请等待${MA_CFG[otherPeriod].label}同步完成（完成后会自动衔接${cfg.label}）` }
  }
  syncMa(period, force) // 不 await，后台执行
  return { ok: true, message: `已启动${cfg.label}后台同步` }
}

/**
 * 快照完成后串行推进均线链：day → week。
 * 以"指数最新交易日/周"为水位，仅落后时触发，保证日/周均线绝不同时并发（防限流）。
 */
async function chainMaAfterSpot(period) {
  if (period === 'day') {
    if (await maNeedSync('day')) {
      await syncMa('day', false)
    }
    // 日线完成/跳过/失败后都衔接周线检查（周线内部自有状态锁）
    await chainMaAfterSpot('week')
  } else if (period === 'week') {
    if (await maNeedSync('week')) await syncMa('week', false)
  }
}

/**
 * APP 启动自动同步（串行链）：
 * 当日快照未拉 → 后台拉快照（完成后自动推进日/周均线）；
 * 快照已最新 → 检查日均线 → 再检查周均线。
 * 水位=最新交易日/周：同一交易日内反复刷新/重进页面不会重复拉取。
 * 在 APP 挂载时调用，不阻塞 UI。
 */
export async function autoSyncOnStartup() {
  await loadMeta()
  if (_metaCache.last_success_date !== dateStr()) {
    syncSpotAsync()
    return
  }
  // 快照已最新：日均线落后则先跑日线，完成后串行检查周线
  try {
    if (await maNeedSync('day')) {
      await syncMa('day', false)
    }
    await chainMaAfterSpot('week')
  } catch (e) {
    // 后台链异常不应中断 APP；各 sync 内部已自行兜底，这里仅防空
    console.warn('autoSync chain error:', e)
  }
}
