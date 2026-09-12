import axios from 'axios'

const BASE_KEY = 'backend_base'

/** 获取后端地址：默认相对路径 /api；手机可设为电脑局域网地址，如 http://192.168.1.5:5175/api */
export function getBackendBase() {
  return localStorage.getItem(BASE_KEY) || '/api'
}

/** 保存后端地址（空串恢复默认） */
export function setBackendBase(url) {
  const v = (url || '').trim().replace(/\/+$/, '')
  if (v) localStorage.setItem(BASE_KEY, v)
  else localStorage.removeItem(BASE_KEY)
}

const api = axios.create({
  timeout: 60000,
})

// 请求拦截：相对路径自动拼接后端地址（便于运行时切换）
api.interceptors.request.use((config) => {
  if (!/^https?:\/\//i.test(config.url)) {
    config.url = getBackendBase() + config.url
  }
  return config
})

/** 获取股票名称列表 */
export async function getStockNames() {
  const { data } = await api.get('/stock-names')
  return data
}

/** 扫描本地股票库，按用神评分排序 */
export async function scanStocks(params) {
  const { data } = await api.get('/scan', { params })
  return data
}

/** 搜索股票 */
export async function searchStocks(keyword) {
  const { data } = await api.get('/search', { params: { q: keyword } })
  return data
}

/** 获取五行分布统计 */
export async function getSectors() {
  const { data } = await api.get('/sectors')
  return data
}

/** 获取同步状态 */
export async function getSyncStatus() {
  const { data } = await api.get('/sync/status')
  return data
}

/** 手动触发同步 */
export async function triggerSync() {
  const { data } = await api.post('/sync')
  return data
}

export default api
