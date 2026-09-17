/**
 * 单只股票 K 线拉取（多源 fallback 链，支持日K/周K）。
 *
 * 兜底链：BaoStock 裸TCP（沪深，原生APK，前复权，快而稳）
 *        → 东财 push2his（沪深北全市场，前复权，镜像轮换）
 *        → 腾讯 ifzq（仅沪深，前复权）
 *        → 新浪（沪深+北交所，不复权，长周期均线对小幅除权不敏感）
 *
 * 周期：period='day' 日K（144/288 日均线），period='week' 周K（144/288 周均线）。
 * BaoStock 不覆盖北交所（bj.* 返回 10004011），北交所由东财/新浪兜底；
 * Web 开发环境无原生 TCP，自动跳过 BaoStock 走 HTTP 链。
 * 实测（2026-09）：BaoStock 单次 0.03~0.06s，东财 push2his 在部分网络连接被重置，
 * 新浪 scale=1200 周K含北交所且可拉 320 根（约6年），腾讯 week 稳定。
 */

import { httpGetJson } from './http.js'
import { toNum } from './ma.js'
import { fetchKlineBs, fetchIndexKlineBs, isBjSymbol } from './baostock.js'

const MA_KLINE_LMT = 320 // 288 均线 + 20 回踩窗口 + 余量（日:交易日 / 周:交易周）
const EM_HOSTS = [
  'push2his.eastmoney.com',
  '1.push2his.eastmoney.com',
  '7.push2his.eastmoney.com',
]

// 周期 → 各数据源的周期参数
const PERIOD_PARAM = {
  day: { emKlt: '101', tx: 'day', sinaScale: '240' },
  week: { emKlt: '102', tx: 'week', sinaScale: '1200' },
}

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

/** 东财 K 线：镜像主机轮换，逐台尝试。period: day/week。 */
export async function fetchKlineEm(secid, period = 'day') {
  const klt = (PERIOD_PARAM[period] || PERIOD_PARAM.day).emKlt
  for (const host of EM_HOSTS) {
    try {
      const url =
        `https://${host}/api/qt/stock/kline/get?secid=${secid}` +
        '&ut=fa5fd1943c7b386f172d6893dbfba10b' +
        '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58' +
        `&klt=${klt}&fqt=1&end=20500101&lmt=${MA_KLINE_LMT}`
      const payload = await httpGetJson(url)
      const rows = parseEmKlines(payload)
      if (rows.length) return rows
    } catch (e) {
      // 换下一台镜像
    }
  }
  return [] // 服务正常但无数据（代码无效）
}

/** 腾讯行情代码（仅沪深，腾讯无北交所K线）。 */
export function txCode(symbol) {
  if (/^(60|68|90)/.test(symbol)) return 'sh' + symbol
  if (/^(00|20|30)/.test(symbol)) return 'sz' + symbol
  return null
}

/**
 * 解析腾讯 fqkline JSON → [[date, close]]。
 * 腾讯日/周K元素可能是字符串("2026-..,..,..")或数组(["2026-..","..",..])，
 * 两种格式均兼容；键名 qfqday/qfqweek（前复权）或 day/week（不复权）。
 */
export function parseTxKlines(payload, code, period = 'day') {
  const node = ((payload || {}).data || {})[code] || {}
  const q = period === 'week' ? 'qfqweek' : 'qfqday'
  const r = period === 'week' ? 'week' : 'day'
  const raw = node[q] || node[r] || []
  const out = []
  for (const it of raw) {
    const parts = Array.isArray(it) ? it : String(it).split(',')
    if (parts.length < 3) continue
    const close = toNum(parts[2])
    if (parts[0] && close) out.push([parts[0], close])
  }
  return out
}

/** 腾讯 K 线（前复权）。period: day/week。 */
export async function fetchKlineTx(code, period = 'day') {
  const txPeriod = (PERIOD_PARAM[period] || PERIOD_PARAM.day).tx
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${txPeriod},,,${MA_KLINE_LMT},qfq`
  const payload = await httpGetJson(url)
  return parseTxKlines(payload, code, period)
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

/** 新浪 K 线（不复权）。period: day(scale=240)/week(scale=1200)。 */
export async function fetchKlineSina(code, period = 'day') {
  const scale = (PERIOD_PARAM[period] || PERIOD_PARAM.day).sinaScale
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/` +
    `CN_MarketData.getKLineData?symbol=${code}&scale=${scale}&ma=no&datalen=${MA_KLINE_LMT}`
  const payload = await httpGetJson(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
  })
  return parseSinaKlines(payload)
}

/**
 * 上证指数最新 K 线（增量同步基准日期），多源兜底：
 * BaoStock sh.000001 → 东财 1.000001 → 腾讯 → 新浪。
 * 返回 [[date, close], ...]；全失败为 []。
 */
export async function fetchIndexKlines(period = 'day') {
  const bsRows = await fetchIndexKlineBs(period)
  if (bsRows.length) return bsRows
  try {
    const rows = await fetchKlineEm('1.000001', period)
    if (rows.length) return rows
  } catch (e) {
    // 降级
  }
  try {
    const rows = await fetchKlineTx('sh000001', period)
    if (rows.length) return rows
  } catch (e) {
    // 降级
  }
  try {
    const rows = await fetchKlineSina('sh000001', period)
    if (rows.length) return rows
  } catch (e) {
    // 全部失败
  }
  return []
}

/**
 * K线兜底链：BaoStock(沪深/原生) → 东财(沪深北) → 腾讯(沪深) → 新浪(含北交所)。
 * symbol 6位代码；period 'day'|'week'。
 * 返回 [[date, close], ...]；全失败为 []。
 */
export async function fetchSymbolKlines(symbol, period = 'day') {
  // 1. BaoStock：仅沪深（北交所其不支持，内部对 bj 直接返回 []）
  if (!isBjSymbol(symbol)) {
    const bsRows = await fetchKlineBs(symbol, period)
    if (bsRows.length) return bsRows
  }
  // 2. 东财（含北交所）
  try {
    const rows = await fetchKlineEm(emSecid(symbol), period)
    if (rows.length) return rows
  } catch (e) {
    // 进入备用源
  }
  // 3. 腾讯（仅沪深）
  const tx = txCode(symbol)
  if (tx) {
    try {
      const rows = await fetchKlineTx(tx, period)
      if (rows.length) return rows
    } catch (e) {
      // 继续
    }
  }
  // 4. 新浪（含北交所，不复权）
  const sc = sinaCode(symbol)
  if (sc) {
    try {
      const rows = await fetchKlineSina(sc, period)
      if (rows.length) return rows
    } catch (e) {
      // 全部失败
    }
  }
  return []
}
