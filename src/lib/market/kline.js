/**
 * 单只股票日K线拉取（多源 fallback 链）。
 *
 * 由 server/data_sync.py 的 _fetch_kline_em/tx/sina 翻译。
 * 兜底链：东财 push2his（沪深北全市场，前复权，镜像轮换）
 *        → 腾讯 ifzq（仅沪深，前复权）
 *        → 新浪（沪深+北交所，不复权，均线对小幅除权不敏感）
 */

import { httpGetJson } from './http.js'
import { toNum } from './ma.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MA_KLINE_LMT = 320 // 288 均线 + 20 回踩窗口 + 余量
const EM_HOSTS = [
  'push2his.eastmoney.com',
  '1.push2his.eastmoney.com',
  '7.push2his.eastmoney.com',
]

/** 东财 secid：60/68 开头为沪市 1.，其余（含北交所）为 0.。 */
export function emSecid(symbol) {
  return (/^(60|68)/.test(symbol) ? '1.' : '0.') + symbol
}

/** 解析东财 kline JSON → [[date, close]]。 */
export function parseEmKlines(payload) {
  const klines = ((payload || {}).data || {}).klines || []
  const out = []
  for (const line of klines) {
    const parts = line.split(',')
    if (parts.length < 3) continue
    const close = toNum(parts[2])
    if (close) out.push([parts[0], close])
  }
  return out
}

/** 东财日K：镜像主机轮换，逐台尝试。 */
export async function fetchKlineEm(secid) {
  for (const host of EM_HOSTS) {
    try {
      const url =
        `https://${host}/api/qt/stock/kline/get?secid=${secid}` +
        '&ut=fa5fd1943c7b386f172d6893dbfba10b' +
        '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58' +
        `&klt=101&fqt=1&end=20500101&lmt=${MA_KLINE_LMT}`
      const payload = await httpGetJson(url)
      const rows = parseEmKlines(payload)
      if (rows.length) return rows
    } catch (e) {
      // 换下一台镜像
    }
  }
  return [] // 服务正常但无数据（代码无效）
}

/** 腾讯行情代码（仅沪深，腾讯无北交所日K）。 */
export function txCode(symbol) {
  if (/^(60|68|90)/.test(symbol)) return 'sh' + symbol
  if (/^(00|20|30)/.test(symbol)) return 'sz' + symbol
  return null
}

/** 解析腾讯 fqkline JSON → [[date, close]]（qfqday/day 两种键）。 */
export function parseTxKlines(payload, code) {
  const node = ((payload || {}).data || {})[code] || {}
  const raw = node.qfqday || node.day || []
  const out = []
  for (const parts of raw) {
    if (parts.length < 3) continue
    const close = toNum(parts[2])
    if (close) out.push([parts[0], close])
  }
  return out
}

export async function fetchKlineTx(code) {
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,${MA_KLINE_LMT},qfq`
  const payload = await httpGetJson(url)
  return parseTxKlines(payload, code)
}

/** 新浪行情代码（沪深 + 北交所 bj 前缀）。 */
export function sinaCode(symbol) {
  const tx = txCode(symbol)
  if (tx) return tx
  if (/^[489]/.test(symbol)) return 'bj' + symbol
  return null
}

/** 解析新浪 getKLineData JSON 数组 → [[date, close]]。 */
export function parseSinaKlines(payload) {
  const out = []
  for (const it of payload || []) {
    const close = toNum(String(it.close || ''))
    const day = it.day || it.date
    if (day && close) out.push([day, close])
  }
  return out
}

export async function fetchKlineSina(code) {
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/` +
    `CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${MA_KLINE_LMT}`
  const payload = await httpGetJson(url)
  return parseSinaKlines(payload)
}

/**
 * 日K兜底链：东财 → 腾讯(沪深) → 新浪(含北交所)。
 * 返回 [[date, close], ...]；全失败为 []。
 */
export async function fetchSymbolKlines(symbol) {
  try {
    const rows = await fetchKlineEm(emSecid(symbol))
    if (rows.length) return rows
  } catch (e) {
    // 进入备用源
  }
  const tx = txCode(symbol)
  if (tx) {
    try {
      const rows = await fetchKlineTx(tx)
      if (rows.length) return rows
    } catch (e) {
      // 继续
    }
  }
  const sc = sinaCode(symbol)
  if (sc) {
    try {
      const rows = await fetchKlineSina(sc)
      if (rows.length) return rows
    } catch (e) {
      // 全部失败
    }
  }
  return []
}
