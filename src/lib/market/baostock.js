/**
 * BaoStock 协议客户端（JavaScript 移植，仅 Android/iOS 原生平台可用）。
 *
 * BaoStock 官方只提供 Python 库，底层是裸 TCP 自定义文本协议（非 HTTP）：
 * - 服务器 public-api.baostock.com:10030（源码 constants 实测）
 * - 请求：21字节文本头 `00.9.30\x01<type>\x01<10位body字节长度>`
 *         + body + `\x01<crc32(head+body)>` + `\n`
 * - 响应：同结构头，K线响应(type=96) body 为 zlib 压缩，
 *         整包以 `<![CDATA[]]>\n` 结尾定界
 * - 登录 anonymous/123456 免注册；单连接请求-响应严格串行
 *
 * 原生 TCP 通道由 @devioarts/capacitor-tcpclient 提供（Capacitor 8，
 * writeAndRead 的 expect 字节定界与本协议结束符天然匹配）。
 * Web 开发环境为 stub，自动跳过（调用方降级 HTTP 数据源链）。
 *
 * 实测（2026-09）：连接 0.12s，日/周/月K单次 0.03~0.06s，
 * 周K一次可取 343 根(2020至今)，4 连接并发全市场约 11 分钟；
 * 不支持北交所（bj.* 返回 10004011），北交所由新浪 HTTP 兜底。
 */

import { Capacitor } from '@capacitor/core'
import { TCPClient } from '@devioarts/capacitor-tcpclient'
import { inflate } from 'pako'
import { toNum } from './ma.js'

const HOST = 'public-api.baostock.com'
const PORT = 10030
const VERSION = '00.9.30'
const SPL = '\x01'
const END_BYTES = new TextEncoder().encode('<![CDATA[]]>\n') // 响应定界符
const END_HEX = Array.from(END_BYTES).map((b) => b.toString(16).padStart(2, '0')).join('')

const TYPE_LOGIN = '00'
const TYPE_KLINE = '95'
const RESP_COMPRESSED = new Set(['96', '99', '9B', '9D'])
const PAGE_SIZE = 2000

// 取数窗口：日K 288 交易日 ≈ 410 自然日，留余量 500 天；
// 周K 288 交易周 ≈ 2016 天，留余量取 2800 天（约 7.7 年）
const LOOKBACK_DAYS = { day: 500, week: 2800 }

const RR_TIMEOUT = 15000
const RR_MAX_BYTES = 2 * 1024 * 1024

// ── CRC32（标准 zlib 表驱动，与 Python zlib.crc32 一致，无符号）──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pad10(n) {
  return String(n).padStart(10, '0')
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 6位代码 → BaoStock 代码。北交所不支持，返回 null。指数走专用入口。 */
export function bsCode(symbol) {
  if (/^(60|68|90)/.test(symbol)) return 'sh.' + symbol
  if (/^(00|20|30)/.test(symbol)) return 'sz.' + symbol
  return null // 北交所（430/83x/920 等）BaoStock 不支持
}

/** 北交所代码（BaoStock 不覆盖，调用方应直接走 HTTP 兜底）。 */
export function isBjSymbol(symbol) {
  return bsCode(symbol) === null
}

// ── 平台可用性 ──
let _platform = null // 'android' | 'ios' | 'web' | ...
let _platformChecked = false
async function nativePlatform() {
  if (!_platformChecked) {
    try {
      const r = await TCPClient.getPluginPlatform()
      _platform = r && !r.error ? r.platform : Capacitor.getPlatform()
    } catch (e) {
      _platform = Capacitor.getPlatform()
    }
    _platformChecked = true
  }
  return _platform
}

/** BaoStock 是否可用（仅 Android/iOS 原生；web 开发环境为 stub）。 */
export async function isAvailable() {
  const pf = await nativePlatform()
  return pf === 'android' || pf === 'ios'
}

// ── 单条连接：懒连接 + 登录 + 断线重登一次 ──
let _connSeq = 0
class BsConnection {
  constructor() {
    this.id = `bs-${++_connSeq}`
    this.conn = null
    this.loggedIn = false
    this.busy = Promise.resolve() // 单连接请求串行链
  }

  async ensure() {
    if (this.conn && this.loggedIn) return
    this.conn = TCPClient.createConnection({
      connectionId: this.id,
      host: HOST,
      port: PORT,
      timeout: 8000,
      noDelay: true,
      keepAlive: true,
    })
    const cr = await this.conn.connect()
    if (cr.error || !cr.connected) throw new Error('BaoStock TCP 连接失败')
    const arr = await this.rawRequest(TYPE_LOGIN, `login${SPL}anonymous${SPL}123456${SPL}0`, true)
    if (!arr || arr[0] !== '0') throw new Error('BaoStock 登录失败')
    this.loggedIn = true
  }

  /** 发送原始报文并解析为 body 字段数组。skipLogin=true 用于登录请求本身。 */
  async rawRequest(type, body, skipLogin = false) {
    const headBody = `${VERSION}${SPL}${type}${SPL}${pad10(new TextEncoder().encode(body).length)}${body}`
    const crc = crc32(new TextEncoder().encode(headBody))
    const payload = new TextEncoder().encode(`${headBody}${SPL}${crc}\n`)

    const rr = await this.conn.writeAndRead({
      data: payload,
      expect: END_HEX,
      timeout: RR_TIMEOUT,
      maxBytes: RR_MAX_BYTES,
    })
    if (rr.error || !rr.data || rr.data.length < 22) {
      throw new Error(rr.errorMessage || 'BaoStock 读取失败')
    }
    const all = new Uint8Array(rr.data)
    const head = new TextDecoder().decode(all.slice(0, 21))
    const headArr = head.split(SPL)
    const respType = headArr[1]
    const innerLen = parseInt(headArr[2], 10) || 0

    let bodyStr
    if (RESP_COMPRESSED.has(respType)) {
      // 压缩体在头之后 innerLen 字节，zlib wrapper（pako.inflate 直接支持）
      const comp = all.slice(21, 21 + innerLen)
      bodyStr = new TextDecoder().decode(inflate(comp))
    } else {
      // 去掉结尾定界符 <![CDATA[]]>\n（13字节）
      bodyStr = new TextDecoder().decode(all.slice(21, all.length - END_BYTES.length))
    }
    return bodyStr.split(SPL)
  }

  /** 带一次重连重试的业务请求。 */
  async request(type, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensure()
        const arr = await this.rawRequest(type, body)
        // 会话过期/未登录：强制重连后重试一次
        if (arr[0] === '10001001' && attempt === 0) {
          this.loggedIn = false
          try { await this.conn?.disconnect() } catch (e) { /* ignore */ }
          this.conn = null
          continue
        }
        return arr
      } catch (e) {
        if (attempt === 0) {
          this.loggedIn = false
          this.conn = null
          continue
        }
        throw e
      }
    }
    throw new Error('BaoStock 请求失败')
  }

  /** 串行排队执行（保证单连接请求-响应不交叉）。 */
  async run(task) {
    const next = this.busy.then(() => task(this))
    // 队列自身永不 reject，避免一次失败炸掉整条链
    this.busy = next.then(() => {}, () => {})
    return next
  }
}

// ── 连接池：4 连接轮询分配 ──
const POOL_SIZE = 4
let _pool = null
let _rrIdx = 0

function pool() {
  if (!_pool) _pool = Array.from({ length: POOL_SIZE }, () => new BsConnection())
  return _pool
}

function nextConn() {
  const c = pool()[_rrIdx % POOL_SIZE]
  _rrIdx = (_rrIdx + 1) % POOL_SIZE
  return c
}

/**
 * BaoStock K 线查询。
 * @param {string} symbol 6位代码（沪深）
 * @param {'day'|'week'} period
 * @returns {Promise<Array<[string, number]>>} [[date, close], ...]；不支持/失败为 []
 */
export async function fetchKlineBs(symbol, period = 'day') {
  if (!(await isAvailable())) return []
  const code = bsCode(symbol)
  if (!code) return [] // 北交所

  const end = new Date()
  const start = new Date(end.getTime() - LOOKBACK_DAYS[period] * 86400000)
  const freq = period === 'week' ? 'w' : 'd'
  const body =
    `query_history_k_data_plus${SPL}anonymous${SPL}1${SPL}${PAGE_SIZE}${SPL}` +
    `${code}${SPL}date,close${SPL}${isoDate(start)}${SPL}${isoDate(end)}${SPL}${freq}${SPL}2` // 2=前复权

  try {
    const arr = await nextConn().run((c) => c.request(TYPE_KLINE, body))
    if (!arr || arr[0] !== '0') return []
    // body 布局：0错误码 1错误信息 2方法 3用户 4页 5每页 6JSON 7代码 8字段 9起 10止 11频率 12复权
    const jsonStr = arr[6] ? arr[6].split(/\s+/).join('') : ''
    if (!jsonStr) return []
    const recs = JSON.parse(jsonStr).record || []
    const out = []
    for (const r of recs) {
      const close = toNum(r[1])
      if (r[0] && close) out.push([r[0], close])
    }
    return out
  } catch (e) {
    return []
  }
}

/**
 * 上证指数 K 线（增量同步基准日期）。
 * BaoStock 指数代码 sh.000001（区别于平安银行 sz.000001）。
 */
export async function fetchIndexKlineBs(period = 'day') {
  if (!(await isAvailable())) return []
  const end = new Date()
  const start = new Date(end.getTime() - LOOKBACK_DAYS[period] * 86400000)
  const freq = period === 'week' ? 'w' : 'd'
  const body =
    `query_history_k_data_plus${SPL}anonymous${SPL}1${SPL}${PAGE_SIZE}${SPL}` +
    `sh.000001${SPL}date,close${SPL}${isoDate(start)}${SPL}${isoDate(end)}${SPL}${freq}${SPL}3`
  try {
    const arr = await nextConn().run((c) => c.request(TYPE_KLINE, body))
    if (!arr || arr[0] !== '0') return []
    const jsonStr = arr[6] ? arr[6].split(/\s+/).join('') : ''
    if (!jsonStr) return []
    const recs = JSON.parse(jsonStr).record || []
    const out = []
    for (const r of recs) {
      const close = toNum(r[1])
      if (r[0] && close) out.push([r[0], close])
    }
    return out
  } catch (catchErr) {
    return []
  }
}

/** 主动关闭全部连接（APP 退后台/测试用）。 */
export async function closeAllBs() {
  if (!_pool) return
  await Promise.all(_pool.map((c) => c.conn?.destroy().catch(() => {})))
  _pool = null
}
