/**
 * HTTP 客户端：原生层绕过 WebView CORS。
 *
 * - Android/iOS（打包 APK 后）：用 @capacitor/core 的 CapacitorHttp，
 *   走原生 HttpURLConnection，不受 WebView 同源策略限制。
 * - Web（开发时）：回退到 fetch + AbortController 超时，东财等公网接口
 *   直连会受 CORS 限制，开发调试可走 Vite proxy。
 *
 * 稳定性：connectTimeout/readTimeout 双超时，避免单源挂死拖垮整个同步池。
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core'

const _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

/** GET 并解析为 JSON。原生走 CapacitorHttp 绕 CORS，web 走 fetch。 */
export async function httpGetJson(url, { headers = {}, timeout = 12000 } = {}) {
  const hdrs = { 'User-Agent': _UA, ...headers }
  if (Capacitor.getPlatform() !== 'web') {
    const resp = await CapacitorHttp.get({
      url,
      headers: hdrs,
      responseType: 'json',
      connectTimeout: timeout,
      readTimeout: timeout,
    })
    if (resp.status >= 400) throw new Error(`HTTP ${resp.status}: ${url}`)
    return resp.data
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { headers: hdrs, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`)
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

/** GET 原始文本（新浪/腾讯部分接口）。 */
export async function httpGetText(url, { headers = {}, timeout = 12000 } = {}) {
  const hdrs = { 'User-Agent': _UA, ...headers }
  if (Capacitor.getPlatform() !== 'web') {
    const resp = await CapacitorHttp.get({
      url,
      headers: hdrs,
      responseType: 'text',
      connectTimeout: timeout,
      readTimeout: timeout,
    })
    if (resp.status >= 400) throw new Error(`HTTP ${resp.status}: ${url}`)
    return resp.data
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { headers: hdrs, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`)
    return await r.text()
  } finally {
    clearTimeout(timer)
  }
}

/** 当前是否原生平台（APK 运行时为 true，可直连公网数据源）。 */
export function isNative() {
  return Capacitor.getPlatform() !== 'web'
}
