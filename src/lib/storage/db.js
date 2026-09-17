/**
 * IndexedDB 本地存储封装。
 *
 * 替代 Python 后端的 SQLite，在 APP 端缓存：
 * - spot：全市场行情快照（symbol 为主键）
 * - ma：144/288 日均线数据（symbol 为主键）
 * - maWeek：144/288 周均线数据（symbol 为主键）
 * - meta：同步元信息（key/value，如 last_success_date、ma_trade_date）
 *
 * Android WebView 支持 IndexedDB，无需原生插件。
 * v1→v2：新增 maWeek 仓库（老用户启动时 onupgradeneeded 自动建店）。
 */

const DB_NAME = 'sequoia_v2'
const DB_VERSION = 2

const STORES = {
  spot: 'symbol',
  ma: 'symbol',
  maWeek: 'symbol',
  meta: 'key',
}

let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath })
          }
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function run(name, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(name, mode)
        const store = t.objectStore(name)
        let result
        const req = fn(store)
        if (req) {
          req.onsuccess = () => {
            result = req.result
          }
          req.onerror = () => reject(req.error)
        }
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      }),
  )
}

/** 单条写入（upsert）。 */
export function put(name, item) {
  return run(name, 'readwrite', (s) => s.put(item))
}

/** 单条读取。 */
export function get(name, key) {
  return run(name, 'readonly', (s) => s.get(key))
}

/** 删除。 */
export function del(name, key) {
  return run(name, 'readwrite', (s) => s.delete(key))
}

/** 清空仓库。 */
export function clear(name) {
  return run(name, 'readwrite', (s) => s.clear())
}

/** 全量读取。 */
export function getAll(name) {
  return run(name, 'readonly', (s) => s.getAll())
}

/** 全部主键。 */
export function getAllKeys(name) {
  return run(name, 'readonly', (s) => s.getAllKeys())
}

/** 计数。 */
export function count(name) {
  return run(name, 'readonly', (s) => s.count())
}

/** 批量 upsert（不 clear，用于均线增量更新）。 */
export function bulkPut(name, items) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(name, 'readwrite')
        const store = t.objectStore(name)
        for (const it of items) store.put(it)
        t.oncomplete = () => resolve(items.length)
        t.onerror = () => reject(t.error)
      }),
  )
}

/** 整表替换（clear + put，用于行情快照每次同步全替换）。 */
export function replaceAll(name, items) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(name, 'readwrite')
        const store = t.objectStore(name)
        store.clear()
        for (const it of items) store.put(it)
        t.oncomplete = () => resolve(items.length)
        t.onerror = () => reject(t.error)
      }),
  )
}

// ── meta 便捷方法（key/value 键值对） ──
export async function getMeta(key) {
  const r = await get('meta', key)
  return r ? r.value : null
}

export function setMeta(key, value) {
  return put('meta', { key, value })
}

// 仓库名常量，供其他模块引用
export const STORE = { SPOT: 'spot', MA: 'ma', MA_WEEK: 'maWeek', META: 'meta' }
