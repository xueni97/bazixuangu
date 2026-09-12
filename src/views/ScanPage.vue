<template>
  <div class="scan-page">
    <van-nav-bar title="股票扫描" left-arrow @click-left="$router.back()">
      <template #right>
        <van-icon name="setting-o" size="20" @click="openSettings" />
      </template>
    </van-nav-bar>

    <div class="scan-layout">
      <!-- 左栏：操作 + 概况 + 结果列表 -->
      <div class="col-main">
        <div class="scan-controls">
          <van-search v-model="keyword" placeholder="搜索股票名称/代码" @search="onSearch" class="search-box" />
          <div class="btn-col">
            <van-button type="primary" size="small" @click="onScan" :loading="loading" class="scan-btn">
              全市场扫描
            </van-button>
            <van-button size="small" plain @click="onSync" :disabled="syncing" class="sync-btn">
              {{ syncing ? '同步中' : '更新数据' }}
            </van-button>
          </div>
        </div>

        <div v-if="scanResult" class="scan-summary">
          <div class="summary-row">
            <van-tag plain type="primary">日期 {{ scanResult.date }}</van-tag>
            <van-tag plain>四柱 {{ scanResult.pillars }}</van-tag>
            <van-tag plain :type="scanResult.dataSource === 'spot' ? 'success' : 'warning'">
              {{ scanResult.dataSource === 'spot' ? '全市场快照' : '名称库(无价格)' }}
            </van-tag>
          </div>
          <div class="summary-row">
            <van-tag plain>日主 {{ scanResult.dayMaster }}</van-tag>
            <van-tag plain :type="scanResult.dayMasterStrength === '弱' ? 'warning' : 'success'">
              {{ scanResult.dayMasterStrength }}
            </van-tag>
            <span class="use-label">用神:</span>
            <span v-for="e in scanResult.useGods" :key="e" class="god-tag" :class="'bg-' + e">{{ e }}</span>
          </div>
          <div class="stat-row">
            扫描 {{ scanResult.totalScanned }} 只 | 命中 {{ scanResult.totalMatched }} 只
          </div>
        </div>

        <div v-if="errorMsg" class="error-state">
          <van-empty image="error" :description="errorMsg">
            <van-button size="small" type="primary" @click="openSettings">检查后端设置</van-button>
          </van-empty>
        </div>

        <div v-if="searchResults.length" class="search-section">
          <div class="section-title">搜索结果</div>
          <div v-for="s in searchResults" :key="s.symbol" class="stock-row" @click="onPickStock(s)">
            <div class="stock-main">
              <span class="code">{{ s.symbol }}</span>
              <span class="name">{{ s.name }}</span>
              <span v-if="s.element" class="elem" :class="'element-' + s.element">{{ s.element }}</span>
            </div>
            <div v-if="s.price" class="quote-mini">
              <span class="price">{{ s.price.toFixed(2) }}</span>
              <span class="chg" :class="s.changePct >= 0 ? 'up' : 'down'">
                {{ s.changePct >= 0 ? '+' : '' }}{{ s.changePct ? s.changePct.toFixed(2) : '0.00' }}%
              </span>
            </div>
          </div>
        </div>

        <div v-if="scanResults.length" class="scan-results">
          <div class="section-title">命理评分排行</div>
          <div v-for="s in scanResults" :key="s.symbol" class="stock-row">
            <div class="stock-top">
              <div class="stock-main">
                <span class="code">{{ s.symbol }}</span>
                <span class="name">{{ s.name }}</span>
                <span class="elem" :class="'element-' + s.element">{{ s.element }}</span>
              </div>
              <div class="stock-score">
                <div class="score-num" :class="scoreClass(s.score)">{{ s.score > 0 ? '+' : '' }}{{ s.score }}</div>
                <div class="score-level">{{ s.level }}</div>
              </div>
            </div>
            <div class="stock-bottom">
              <span class="reason">{{ s.reason }}</span>
              <span v-if="s.price" class="quote-mini">
                <span class="price">{{ s.price.toFixed(2) }}</span>
                <span class="chg" :class="s.changePct >= 0 ? 'up' : 'down'">
                  {{ s.changePct >= 0 ? '+' : '' }}{{ s.changePct ? s.changePct.toFixed(2) : '0.00' }}%
                </span>
              </span>
            </div>
          </div>
        </div>

        <div v-if="loading" class="loading">
          <van-loading type="spinner" />扫描中...
        </div>

        <div v-if="!loading && !scanResults.length && !searchResults.length && !errorMsg" class="empty-state">
          <van-icon name="search" size="48" color="#555" />
          <p>点击「全市场扫描」开始命理选股</p>
        </div>
      </div>

      <!-- 右栏：桌面大屏专用（五行分布 + 同步面板） -->
      <div class="col-side">
        <div class="side-card" v-if="sectorCounts">
          <div class="card-title">全市场五行分布</div>
          <div class="sector-chart">
            <div v-for="e in ['木','火','土','金','水','未知']" :key="e" class="sector-line">
              <span class="sector-elem" :class="'element-' + (e === '未知' ? '' : e)">{{ e }}</span>
              <div class="bar-track">
                <div class="bar-fill" :class="'bar-' + e"
                  :style="{ width: sectorPct(e) + '%' }"></div>
              </div>
              <span class="sector-count">{{ sectorCounts[e] }}</span>
            </div>
          </div>
        </div>

        <div class="side-card">
          <div class="card-title">数据同步</div>
          <div class="sync-info">
            <div class="sync-line">
              <span class="lbl">状态</span>
              <span :class="syncing ? 'syncing-txt' : 'ok-txt'">{{ syncStatusText }}</span>
            </div>
            <div class="sync-line">
              <span class="lbl">最近成功</span>
              <span>{{ syncState.lastSuccessDate || '从未同步' }}</span>
            </div>
            <div class="sync-line">
              <span class="lbl">快照数量</span>
              <span>{{ syncState.spotCount || 0 }} 只</span>
            </div>
            <div class="sync-line" v-if="syncState.phase">
              <span class="lbl">进度</span>
              <span>{{ syncState.phase }}</span>
            </div>
            <div class="sync-line" v-if="syncState.lastError">
              <span class="lbl">错误</span>
              <span class="err-txt">{{ syncState.lastError }}</span>
            </div>
            <van-button size="small" type="primary" plain block @click="onSync" :disabled="syncing"
              style="margin-top: 10px">
              {{ syncing ? '同步中...' : '立即同步全市场快照' }}
            </van-button>
          </div>
        </div>

        <div class="side-card tips-card">
          <div class="card-title">手机联用</div>
          <p class="tip-text">手机与电脑连同一WiFi，点右上角设置填入电脑地址即可在手机上扫描全市场数据。</p>
        </div>
      </div>
    </div>

    <!-- 后端地址设置弹窗 -->
    <van-popup v-model:show="showSettings" round position="bottom" style="padding: 20px">
      <div class="settings-title">后端地址设置</div>
      <van-field v-model="backendInput" label="地址" placeholder="http://192.168.x.x:5175/api" />
      <p class="settings-tip">
        默认使用本地服务（电脑浏览器）。手机APK连电脑时，填电脑局域网地址（电脑启动服务时会打印）。
      </p>
      <div style="margin-top: 12px; display: flex; gap: 8px">
        <van-button block @click="showSettings = false">取消</van-button>
        <van-button block type="primary" @click="saveSettings">保存</van-button>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { showToast } from 'vant'
import {
  scanStocks, searchStocks, getSectors, getSyncStatus, triggerSync,
  getBackendBase, setBackendBase,
} from '../api'
import { StockElementAnalyzer, YuanhaiDecisionModel, BaziEngine } from '../core'

const keyword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const scanResult = ref(null)
const scanResults = ref([])
const searchResults = ref([])
const sectorCounts = ref(null)

const syncState = ref({})
const syncing = ref(false)
let syncTimer = null

const showSettings = ref(false)
const backendInput = ref('')

const syncStatusText = computed(() => {
  if (syncing.value) return '同步中...'
  if (syncState.value.todaySynced) return '今日快照已最新'
  if (syncState.value.status === 'failed') return '上次同步失败'
  return syncState.value.lastSuccessDate ? '待更新' : '未同步'
})

function sectorPct(e) {
  if (!sectorCounts.value) return 0
  const max = Math.max(...Object.values(sectorCounts.value), 1)
  return Math.round((sectorCounts.value[e] / max) * 100)
}

async function refreshSyncStatus(silent = true) {
  try {
    const st = await getSyncStatus()
    const wasSyncing = syncing.value
    syncing.value = st.status === 'syncing'
    syncState.value = { ...st, spotCount: st.spot_count }
    // 同步从进行中变为结束 → 刷新分布图，并提示
    if (wasSyncing && !syncing.value) {
      loadSectors()
      showToast(st.lastError ? '同步失败' : '数据同步完成')
    }
  } catch {
    if (!silent) showToast('无法获取同步状态：后端未启动')
  }
}

function startSyncPolling() {
  stopSyncPolling()
  syncTimer = setInterval(() => {
    refreshSyncStatus()
    if (!syncing.value) stopSyncPolling()
  }, 2000)
}

function stopSyncPolling() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
}

async function onSync() {
  try {
    const r = await triggerSync()
    showToast(r.message || '已触发')
    syncing.value = true
    startSyncPolling()
  } catch (e) {
    if (e.response && e.response.status === 409) {
      showToast('同步进行中，请稍候')
      startSyncPolling()
    } else {
      showToast('触发失败：' + (e.message || '后端未启动'))
    }
  }
}

async function loadSectors() {
  try {
    sectorCounts.value = await getSectors()
  } catch { /* 忽略：分布图非核心功能 */ }
}

async function onScan() {
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await scanStocks({ minScore: 10, limit: 200 })
    scanResult.value = data
    scanResults.value = data.results || []
    searchResults.value = []
    if (!syncing.value) loadSectors()
  } catch (e) {
    scanResults.value = []
    scanResult.value = null
    errorMsg.value = '扫描失败：' + (e.message || '后端未启动') + '。手机使用请先在右上角设置后端地址。'
  } finally {
    loading.value = false
  }
}

async function onSearch() {
  if (!keyword.value.trim()) return
  loading.value = true
  errorMsg.value = ''
  try {
    const results = await searchStocks(keyword.value.trim())
    // 本地计算五行与评分
    const pillars = BaziEngine.from_datetime(new Date())
    const analysis = YuanhaiDecisionModel.analyze(pillars)
    searchResults.value = results.map(s => {
      const elem = StockElementAnalyzer.combined_element(s.name)
      const info = YuanhaiDecisionModel.stock_score(elem, analysis, s.name)
      return { ...s, element: elem, score: info.score, level: info.level, reason: info.reason }
    })
    scanResults.value = []
  } catch (e) {
    errorMsg.value = '搜索失败：' + (e.message || '后端未启动')
  } finally {
    loading.value = false
  }
}

function onPickStock(s) {
  keyword.value = s.name
  searchResults.value = []
}

function openSettings() {
  backendInput.value = getBackendBase() === '/api' ? '' : getBackendBase()
  showSettings.value = true
}

function saveSettings() {
  setBackendBase(backendInput.value)
  showSettings.value = false
  showToast('已保存，可重新扫描验证')
}

function scoreClass(score) {
  if (score >= 45) return 'score-top'
  if (score >= 15) return 'score-good'
  if (score >= -10) return 'score-neutral'
  if (score >= -35) return 'score-warn'
  return 'score-bad'
}

onMounted(() => {
  refreshSyncStatus()
  loadSectors()
})

onUnmounted(() => stopSyncPolling())
</script>

<style scoped>
.scan-page { padding-bottom: 40px; }

/* ── 双栏布局：桌面 >=960px 启用 ── */
.scan-layout { display: block; }
.col-side { display: none; }

@media (min-width: 960px) {
  .scan-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
    padding: 0 16px;
    align-items: start;
  }
  .col-side { display: block; position: sticky; top: 12px; }
  .scan-controls, .scan-summary, .search-section, .scan-results,
  .error-state, .loading, .empty-state { padding-left: 0; padding-right: 0; margin-left: 0; margin-right: 0; }
}

.scan-controls {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  align-items: flex-start;
}
.search-box { flex: 1; padding: 4px 0; background: transparent; }
.btn-col { display: flex; flex-direction: column; gap: 6px; }
.scan-btn { flex-shrink: 0; }
.sync-btn { flex-shrink: 0; }

.scan-summary {
  margin: 0 12px 12px;
  padding: 12px;
  background: var(--bg-card);
  border-radius: 10px;
}
.summary-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.use-label { font-size: 12px; color: var(--text-secondary); }
.god-tag { padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid; }
.stat-row { font-size: 12px; color: var(--text-secondary); }

.search-section, .scan-results { padding: 0 12px; }
.section-title { font-size: 14px; font-weight: bold; margin-bottom: 8px; }

.stock-row {
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
}
.stock-top { display: flex; justify-content: space-between; gap: 8px; }
.stock-main { display: flex; gap: 8px; align-items: center; flex: 1; min-width: 0; }
.code { font-size: 13px; color: var(--text-secondary); font-family: monospace; }
.name { font-size: 15px; font-weight: bold; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.elem { font-size: 12px; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }

.stock-score { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.score-num { font-size: 18px; font-weight: bold; }
.score-level { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); }
.score-top { color: #4caf50; }
.score-good { color: #8bc34a; }
.score-neutral { color: #ffc107; }
.score-warn { color: #ff9800; }
.score-bad { color: #f44336; }

.stock-bottom {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 6px; gap: 8px;
}
.reason { font-size: 12px; color: var(--text-secondary); flex: 1; min-width: 0; }

.quote-mini { display: flex; gap: 6px; align-items: baseline; flex-shrink: 0; font-family: monospace; }
.price { font-size: 13px; font-weight: bold; }
.chg { font-size: 12px; }
.chg.up { color: #f44336; }
.chg.down { color: #4caf50; }

.error-state { margin: 20px 12px; }
.loading { text-align: center; padding: 40px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
.empty-state p { margin-top: 12px; font-size: 14px; }

/* ── 桌面右栏卡片 ── */
.side-card {
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.card-title { font-size: 14px; font-weight: bold; margin-bottom: 12px; }

.sector-line { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sector-elem { width: 20px; font-weight: bold; font-size: 13px; }
.bar-track { flex: 1; height: 10px; background: rgba(255,255,255,0.08); border-radius: 5px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 5px; transition: width 0.5s ease; }
.bar-木 { background: var(--wood); }
.bar-火 { background: var(--fire); }
.bar-土 { background: var(--earth); }
.bar-金 { background: var(--metal); }
.bar-水 { background: var(--water); }
.bar-未知 { background: #666; }
.sector-count { width: 40px; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: monospace; }

.sync-info { display: flex; flex-direction: column; gap: 8px; }
.sync-line { display: flex; gap: 10px; font-size: 13px; }
.sync-line .lbl { color: var(--text-secondary); width: 60px; flex-shrink: 0; }
.ok-txt { color: #4caf50; }
.syncing-txt { color: #f5a623; }
.err-txt { color: #f44336; word-break: break-all; }

.tips-card .tip-text { font-size: 12px; color: var(--text-secondary); line-height: 1.6; }

.settings-title { font-size: 16px; font-weight: bold; margin-bottom: 12px; text-align: center; }
.settings-tip { font-size: 12px; color: var(--text-secondary); margin-top: 8px; line-height: 1.5; }
</style>
