/**
 * 轻量批量实时报价：按页面当前节点涉及的标的拉取（几十~上百只，秒级）。
 *
 * 与全市场 spot 同步（5918 只、~30 秒）互补：自选/扫描页面盘中想刷新
 * 当前持仓或当前结果行的最新价时，只拉这些票，一次批量请求完成。
 *
 * 数据源：
 * - Web 服务器部署（构建期注入 VITE_API_BASE）：POST {API}/api/quotes，
 *   服务器端批量查东财/腾讯
 * - 本地 / APP（Capacitor WebView 直连 HTTPS）：
 *   东财 push2 ulist → push2delay（延时域兜底）→ 腾讯 qt.gtimg.cn
 *
 * 返回 Map：symbol → { price:number, changePct:number }；停牌/无数据的票
 * 不进入 Map，由调用方按缺失处理。
 */

import { emSecid } from './kline.js'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const BATCH = 100          // 东财 ulist 单批 secids 数
const REQ_TIMEOUT = 8000   // 单请求超时

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function httpGet(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT)
  try {
    const resp = await fetch(url, { signal: ctrl.signal })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    return await resp.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 东财 ulist 批量报价（push2 / push2delay 两域轮换）。
 * 返回 Map symbol → {price, changePct}。
 */
async function pullEmBatch(symbols, host = 'push2') {
  const secids = symbols.map(emSecid).join(',')
  const url = `https://${host}.eastmoney.com/api/qt/ulist.np/get` +
    `?fltt=2&invt=2&fields=f2,f3,f12&secids=${encodeURIComponent(secids)}`
  const text = await httpGet(url)
  const payload = JSON.parse(text)
  const diff = ((payload || {}).data || {}).diff || []
  const out = new Map()
  for (const d of diff) {
    const price = toNum(d.f2)
    if (price == null) continue // 停牌 f2='-'
    out.set(String(d.f12), { price, changePct: toNum(d.f3) ?? null })
  }
  return out
}

/** 腾讯实时报价代码（沪深 sh/sz，北交所 bj；腾讯 K线不支持 bj，故独立于 txCode）。 */
function txQuoteCode(symbol) {
  if (/^(60|68|90)/.test(symbol)) return 'sh' + symbol
  if (/^(00|20|30)/.test(symbol)) return 'sz' + symbol
  return 'bj' + symbol
}

/**
 * 腾讯批量报价（GBK 文本；只解析 ASCII 字段，无编码依赖）。
 * 沪深：v_sh600519="1~名称~代码~最新价~昨收~...~涨跌幅%"，
 *   最新价=[3]，昨收=[4]，涨跌幅=[32]
 * 北交所：v_bj830799="62~名称~代码~最新价~昨收~..." 字段较短，
 *   涨跌幅由 最新价/昨收 计算
 */
async function pullTxBatch(symbols) {
  const codes = symbols.map(txQuoteCode).join(',')
  const text = await httpGet('https://qt.gtimg.cn/q=' + codes)
  const out = new Map()
  const re = /v_[a-z]{2}\d+="([^"]*)";/g
  let m
  while ((m = re.exec(text)) !== null) {
    const f = m[1].split('~')
    if (f.length < 5) continue
    const sym = f[2]
    const price = toNum(f[3])
    const prevClose = toNum(f[4])
    if (!sym || price == null || price <= 0) continue
    let changePct = f.length >= 33 ? toNum(f[32]) : null
    if (changePct == null && prevClose > 0) {
      changePct = Math.round(((price - prevClose) / prevClose) * 10000) / 100
    }
    out.set(sym, { price, changePct })
  }
  return out
}

/** 服务器端批量报价（POST /api/quotes）。 */
async function pullFromServer(symbols) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const resp = await fetch(API_BASE + '/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
      signal: ctrl.signal,
    })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const payload = await resp.json()
    const out = new Map()
    const quotes = payload.quotes || {}
    for (const [sym, q] of Object.entries(quotes)) {
      if (q && Number.isFinite(Number(q.price))) {
        out.set(sym, { price: Number(q.price), changePct: q.change_pct ?? null })
      }
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 批量实时报价主入口。
 * @param {string[]} symbols - 标的代码列表（自动去重）
 * @returns {Promise<Map<string, {price:number, changePct:number|null}>>}
 */
export async function fetchQuotes(symbols) {
  const list = [...new Set((symbols || []).filter(Boolean))]
  const out = new Map()
  if (!list.length) return out

  if (API_BASE) {
    try {
      const got = await pullFromServer(list)
      for (const [k, v] of got) out.set(k, v)
      return out
    } catch {
      // 服务器报价接口异常时落到下面直连链（Web 浏览器可直连东财）
    }
  }

  // 东财分批（主域失败切延时域），缺失票最后腾讯补
  const missing = []
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH)
    let got = null
    for (const host of ['push2', 'push2delay']) {
      try {
        got = await pullEmBatch(batch, host)
        break
      } catch {
        // 下一域
      }
    }
    for (const s of batch) {
      if (got && got.has(s)) out.set(s, got.get(s))
      else missing.push(s)
    }
  }
  if (missing.length) {
    try {
      const got = await pullTxBatch(missing)
      for (const [k, v] of got) out.set(k, v)
    } catch {
      // 腾讯也失败：这些票保持缺失，调用方按"无实时价"处理
    }
  }
  return out
}
