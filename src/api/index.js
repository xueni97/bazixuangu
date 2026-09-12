import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
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

export default api
