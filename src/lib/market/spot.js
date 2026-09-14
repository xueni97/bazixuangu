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

/** 东财延时域全市场快照（分页拉取）。 */
export async function fetchEastmoneySpot() {
  const all = new Map()
  let page = 1
  while (true) {
    const url =
      'https://push2delay.eastmoney.com/api/qt/clist/get?' +
      `pn=${page}&pz=${EM_PAGE_SIZE}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281` +
      `&fltt=2&invt=2&fid=f12&fs=${encodeURIComponent(EM_FS)}&fields=f12,f13,f14,f2,f3`
    const payload = await httpGetJson(url)
    const rows = parseEmPayload(payload)
    if (!rows.length) break
    for (const r of rows) all.set(r.symbol, r)
    const total = ((payload || {}).data || {}).total || 0
    if (page * EM_PAGE_SIZE >= total || rows.length < EM_PAGE_SIZE) break
    page++
    await sleep(200)
  }
  return Array.from(all.values())
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

/** 新浪 hs_a 节点分页列表（兜底源）。 */
export async function fetchSinaSpot() {
  const all = new Map()
  let page = 1
  const num = 80
  while (true) {
    const url =
      'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      `Market_Center.getHQNodeData?page=${page}&num=${num}&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page`
    const items = await httpGetJson(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    })
    const rows = parseSinaList(items)
    if (!rows.length) break
    for (const r of rows) all.set(r.symbol, r)
    if ((items || []).length < num) break
    page++
    await sleep(200)
  }
  return Array.from(all.values())
}

/** 多源 fallback：东财 → 新浪。返回 {rows, source}。 */
export async function fetchSpot() {
  try {
    const rows = await fetchEastmoneySpot()
    if (rows.length) return { rows, source: 'eastmoney' }
  } catch (e) {
    console.warn('[spot] 东财快照失败，切换新浪', e)
  }
  const rows = await fetchSinaSpot()
  if (!rows.length) throw new Error('所有行情数据源均失败')
  return { rows, source: 'sina' }
}
