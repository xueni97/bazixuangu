/**
 * 全市场行情快照拉取（多源 fallback）。
 *
 * 由 server/data_sync.py 的 _fetch_eastmoney / _fetch_sina 翻译。
 * 数据源链：东财 push2delay（全市场含北交所，分页）→ 新浪列表（兜底）。
 * 东财快照自带股票名，APP 无需预置名称表。
 */

import { httpGetJson } from './http.js'
import { toNum, classifyMarket } from './ma.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const EM_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'
const EM_PAGE_SIZE = 100

function nowStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 解析东财 clist JSON → 规范化行。 */
export function parseEmPayload(payload) {
  const data = (payload || {}).data || {}
  const diffs = data.diff || []
  const now = nowStr()
  const rows = []
  for (const d of diffs) {
    const symbol = String(d.f12 || '').trim()
    if (!symbol) continue
    rows.push({
      symbol,
      name: String(d.f14 || '').trim(),
      price: toNum(d.f2),
      changePct: toNum(d.f3),
      market: classifyMarket(symbol),
      updatedAt: now,
    })
  }
  return rows
}

/**
 * 带重试的单页请求：最多 1+retries 次，递增间隔。
 * 全部失败抛异常，由调用方决定跳页或中止。
 */
async function httpGetJsonRetry(url, opts = {}, retries = 2) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      return await httpGetJson(url, opts)
    } catch (e) {
      lastErr = e
      if (i < retries) await sleep(500 * (i + 1))
    }
  }
  throw lastErr
}

// 单源允许跳过的最大失败页数：超过则判定源不可用（切换下一源）
const MAX_FAILED_PAGES = 6

/**
 * 东财延时域全市场快照（分页拉取）。
 * 单页失败：重试 2 次后跳过该页继续拉后续页（避免一页抖动导致整体失败）；
 * 失败页累计 > MAX_FAILED_PAGES 才判定源不可用。
 * 返回 { rows, failedPages }。
 */
export async function fetchEastmoneySpot() {
  const all = new Map()
  let page = 1
  let failedPages = 0
  while (true) {
    const url =
      'https://push2delay.eastmoney.com/api/qt/clist/get?' +
      `pn=${page}&pz=${EM_PAGE_SIZE}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281` +
      `&fltt=2&invt=2&fid=f12&fs=${encodeURIComponent(EM_FS)}&fields=f12,f13,f14,f2,f3`
    let rows = []
    let payload = null
    try {
      payload = await httpGetJsonRetry(url)
      rows = parseEmPayload(payload)
    } catch (e) {
      failedPages++
      if (failedPages > MAX_FAILED_PAGES) {
        throw new Error(`东财快照失败页过多（${failedPages} 页），判定源不可用`)
      }
      console.warn(`[spot] 东财第 ${page} 页重试后仍失败，跳过继续`)
      page++
      continue
    }
    if (!rows.length) break
    for (const r of rows) all.set(r.symbol, r)
    const total = ((payload || {}).data || {}).total || 0
    if (page * EM_PAGE_SIZE >= total || rows.length < EM_PAGE_SIZE) break
    page++
    await sleep(200)
  }
  return { rows: Array.from(all.values()), failedPages }
}

/** 解析新浪列表 JSON。 */
export function parseSinaList(items) {
  const now = nowStr()
  const rows = []
  for (const d of items || []) {
    const raw = String(d.symbol || '').trim() // 如 sh600519 / bj920000
    const symbol = raw.slice(-6)
    if (!/^\d{6}$/.test(symbol)) continue
    rows.push({
      symbol,
      name: String(d.name || '').trim(),
      price: toNum(d.trade),
      changePct: toNum(d.changepercent),
      market: classifyMarket(symbol),
      updatedAt: now,
    })
  }
  return rows
}

/** 新浪 hs_a 节点分页列表（兜底源）。容错逻辑同东财。返回 { rows, failedPages }。 */
export async function fetchSinaSpot() {
  const all = new Map()
  let page = 1
  let failedPages = 0
  const num = 80
  while (true) {
    const url =
      'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      `Market_Center.getHQNodeData?page=${page}&num=${num}&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page`
    let items = []
    try {
      items = await httpGetJsonRetry(url, {
        headers: { Referer: 'https://finance.sina.com.cn' },
      })
    } catch (e) {
      failedPages++
      if (failedPages > MAX_FAILED_PAGES) {
        throw new Error(`新浪快照失败页过多（${failedPages} 页），判定源不可用`)
      }
      console.warn(`[spot] 新浪第 ${page} 页重试后仍失败，跳过继续`)
      page++
      continue
    }
    const rows = parseSinaList(items)
    if (!rows.length) break
    for (const r of rows) all.set(r.symbol, r)
    if ((items || []).length < num) break
    page++
    await sleep(200)
  }
  return { rows: Array.from(all.values()), failedPages }
}

/** 多源 fallback：东财 → 新浪。返回 {rows, source}（跳页时 source 带 -pN 后缀）。 */
export async function fetchSpot() {
  let lastFail
  try {
    const { rows, failedPages } = await fetchEastmoneySpot()
    if (rows.length) {
      return { rows, source: failedPages ? `eastmoney-p${failedPages}` : 'eastmoney' }
    }
  } catch (e) {
    lastFail = e
    console.warn('[spot] 东财快照失败，切换新浪', e)
  }
  try {
    const { rows, failedPages } = await fetchSinaSpot()
    if (rows.length) {
      return { rows, source: failedPages ? `sina-p${failedPages}` : 'sina' }
    }
  } catch (e) {
    console.warn('[spot] 新浪快照也失败', e)
  }
  throw new Error(`所有行情数据源均失败${lastFail ? `（东财：${lastFail.message}）` : ''}`)
}
