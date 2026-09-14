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

        <!-- 周期叠加 + 属性筛选 -->
        <div class="filter-card">
          <div class="filter-row">
            <span class="filter-label">周期效应</span>
            <van-checkbox-group v-model="periods" direction="horizontal" class="period-group">
              <van-checkbox name="monthly" shape="square" icon-size="15">月</van-checkbox>
              <van-checkbox name="weekly" shape="square" icon-size="15">周</van-checkbox>
              <van-checkbox name="daily" shape="square" icon-size="15">日</van-checkbox>
            </van-checkbox-group>
            <span class="filter-hint">月0.5/周0.3/日0.2 加权</span>
          </div>
          <div class="filter-row">
            <span class="filter-label">五行属性</span>
            <div class="chip-group">
              <span
                v-for="e in ELEMENT_OPTIONS" :key="e"
                class="filter-chip"
                :class="[{ active: selectedElements.includes(e) }, 'bg-' + e]"
                @click="toggleElement(e)"
              >{{ e }}</span>
            </div>
          </div>
          <div class="filter-row">
            <span class="filter-label">市场</span>
            <div class="chip-group">
              <span
                class="filter-chip" :class="{ active: selectedMarkets.length === 0 }"
                @click="selectedMarkets = []"
              >全部</span>
              <span
                v-for="m in MARKET_OPTIONS" :key="m"
                class="filter-chip" :class="{ active: selectedMarkets.includes(m) }"
                @click="toggleMarket(m)"
              >{{ m }}</span>
            </div>
          </div>
          <div class="filter-row">
            <span class="filter-label">价格区间</span>
            <input v-model="minPrice" class="price-input" type="number" placeholder="最低" />
            <span class="price-sep">—</span>
            <input v-model="maxPrice" class="price-input" type="number" placeholder="最高" />
            <span class="filter-hint">元（留空不限）</span>
          </div>
        </div>

        <div v-if="scanResult" class="scan-summary">
          <div class="summary-row">
            <van-tag plain type="primary">日期 {{ scanResult.date }}</van-tag>
            <van-tag plain :type="scanResult.dataSource === 'spot' ? 'success' : 'warning'">
              {{ scanResult.dataSource === 'spot' ? '全市场快照' : '名称库(无价格)' }}
            </van-tag>
          </div>
          <!-- 各勾选周期的盘面用神 -->
          <div v-for="p in scanResult.periods" :key="p.key" class="period-summary">
            <span class="period-name">{{ p.label }}效应</span>
            <span class="period-date">{{ p.date }}</span>
            <span class="period-pillars">{{ p.pillars }}</span>
            <span class="use-label">用神:</span>
            <span v-for="g in p.useGods" :key="g" class="god-tag" :class="'bg-' + g">{{ g }}</span>
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
          <div class="section-title">搜索结果（本地综合评分）</div>
          <div v-for="s in searchResults" :key="s.symbol" class="stock-row" @click="onPickStock(s)">
            <div class="stock-top">
              <div class="stock-main">
                <span class="code">{{ s.symbol }}</span>
                <span class="name">{{ s.name }}</span>
                <span v-if="s.element" class="elem" :class="'element-' + s.element">{{ s.element }}</span>
                <span v-if="s.market" class="market-tag">{{ s.market }}</span>
              </div>
              <div class="stock-score">
                <div class="score-num" :class="scoreClass(s.score)">{{ s.score > 0 ? '+' : '' }}{{ s.score }}</div>
                <div class="score-level">{{ s.level }}</div>
              </div>
            </div>
            <!-- 月/周/日分项评分 -->
            <div v-if="s.periodScores" class="period-scores">
              <span
                v-for="p in periodList(s)" :key="p.key"
                class="period-score"
                :class="scoreClass(p.score)"
              >
                <em>{{ p.label }}</em>{{ p.score > 0 ? '+' : '' }}{{ p.score }}
              </span>
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

        <div v-if="scanResults.length" class="scan-results">
          <div class="section-title">命理评分排行</div>
          <div v-for="s in scanResults" :key="s.symbol" class="stock-row">
            <div class="stock-top">
              <div class="stock-main">
                <span class="code">{{ s.symbol }}</span>
                <span class="name">{{ s.name }}</span>
                <span class="elem" :class="'element-' + s.element">{{ s.element }}</span>
                <span v-if="s.market" class="market-tag">{{ s.market }}</span>
              </div>
              <div class="stock-score">
                <div class="score-num" :class="scoreClass(s.score)">{{ s.score > 0 ? '+' : '' }}{{ s.score }}</div>
                <div class="score-level">{{ s.level }}</div>
              </div>
            </div>
            <!-- 月/周/日分项评分 -->
            <div v-if="s.periodScores" class="period-scores">
              <span
                v-for="p in periodList(s)" :key="p.key"
                class="period-score"
                :class="scoreClass(p.score)"
              >
                <em>{{ p.label }}</em>{{ p.score > 0 ? '+' : '' }}{{ p.score }}
              </span>
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
import { StockElementAnalyzer, YuanhaiDecisionModel } from '../core'

const keyword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const scanResult = ref(null)
const scanResults = ref([])
const searchResults = ref([])
const sectorCounts = ref(null)

// ── 多周期叠加 + 属性筛选状态 ──
const ELEMENT_OPTIONS = ['木', '火', '土', '金', '水']
const MARKET_OPTIONS = ['沪', '深', '北交所']
const PERIOD_LABEL = { monthly: '月', weekly: '周', daily: '日' }
const periods = ref(['monthly', 'weekly', 'daily'])
const selectedElements = ref([])
const selectedMarkets = ref([])
const minPrice = ref('')
const maxPrice = ref('')

function toggleElement(e) {
  const i = selectedElements.value.indexOf(e)
  if (i === -1) selectedElements.value.push(e)
  else selectedElements.value.splice(i, 1)
}

function toggleMarket(m) {
  const i = selectedMarkets.value.indexOf(m)
  if (i === -1) selectedMarkets.value.push(m)
  else selectedMarkets.value.splice(i, 1)
}

// 结果行按勾选顺序输出分项分（月→周→日）
function periodList(stock) {
  return periods.value
    .map((key) => ({ key, label: PERIOD_LABEL[key], score: stock.periodScores?.[key]?.score }))
    .filter((p) => p.score !== undefined)
}

// 组装扫描/筛选参数（键名与后端 snake_case 对齐）
function buildScanParams() {
  const params = { min_score: 10, limit: 200, periods: periods.value.join(',') }
  if (selectedElements.value.length) params.elements = selectedElements.value.join(',')
  if (selectedMarkets.value.length) params.markets = selectedMarkets.value.join(',')
  if (minPrice.value !== '') params.min_price = minPrice.value
  if (maxPrice.value !== '') params.max_price = maxPrice.value
  return params
}

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
  if (!periods.value.length) {
    showToast('请至少勾选一个周期效应')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await scanStocks(buildScanParams())
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
  if (!periods.value.length) {
    showToast('请至少勾选一个周期效应')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const results = await searchStocks(keyword.value.trim())
    // 本地按勾选周期计算五行与综合评分（搜索不做属性硬过滤，仅评分展示）
    const periodData = YuanhaiDecisionModel.periodAnalyses(new Date())
    searchResults.value = results.map(s => {
      const elem = StockElementAnalyzer.combined_element(s.name)
      const info = YuanhaiDecisionModel.compositeScore(elem, periodData, periods.value, s.name)
      return {
        ...s,
        element: elem,
        score: info.score,
        level: info.level,
        reason: info.reason,
        periodScores: info.periodScores,
      }
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
  .scan-controls, .filter-card, .scan-summary, .search-section, .scan-results,
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

/* ── 周期叠加 + 属性筛选面板 ── */
.filter-card {
  margin: 0 12px 12px;
  padding: 6px 12px;
  background: var(--bg-card);
  border-radius: 10px;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  flex-wrap: wrap;
}
.filter-row + .filter-row { border-top: 1px solid rgba(255,255,255,0.06); }
.filter-label { font-size: 13px; color: var(--text-secondary); width: 56px; flex-shrink: 0; }
.filter-hint { font-size: 11px; color: var(--text-secondary); }
.period-group { display: flex; gap: 16px; flex: 1; }
.period-group :deep(.van-checkbox__label) { color: var(--text-primary); margin-left: 4px; }

.chip-group { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-chip {
  padding: 3px 14px;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.18);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  user-select: none;
}
.filter-chip.active {
  color: #fff;
  border-color: var(--accent);
  background: rgba(233,69,96,0.25);
}

.price-input {
  width: 74px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--text-primary);
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
}
.price-input::placeholder { color: #777; }
.price-sep { color: var(--text-secondary); font-size: 12px; }

/* 五行配色（中文类名，与元素取值一致；chip 与用神标签共用） */
.element-木 { color: var(--wood); }
.element-火 { color: var(--fire); }
.element-土 { color: var(--earth); }
.element-金 { color: var(--metal); }
.element-水 { color: var(--water); }

.bg-木 { background: rgba(76,175,80,0.15); border-color: var(--wood); color: var(--wood); }
.bg-火 { background: rgba(244,67,54,0.15); border-color: var(--fire); color: var(--fire); }
.bg-土 { background: rgba(255,152,0,0.15); border-color: var(--earth); color: var(--earth); }
.bg-金 { background: rgba(189,189,189,0.15); border-color: var(--metal); color: var(--metal); }
.bg-水 { background: rgba(33,150,243,0.15); border-color: var(--water); color: var(--water); }

.filter-chip.bg-木.active { background: rgba(76,175,80,0.35); color: #fff; }
.filter-chip.bg-火.active { background: rgba(244,67,54,0.35); color: #fff; }
.filter-chip.bg-土.active { background: rgba(255,152,0,0.35); color: #fff; }
.filter-chip.bg-金.active { background: rgba(189,189,189,0.35); color: #fff; }
.filter-chip.bg-水.active { background: rgba(33,150,243,0.35); color: #fff; }

/* ── 扫描概况：各周期盘面用神 ── */
.period-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  margin: 4px 0;
}
.period-name { font-weight: bold; color: var(--text-primary); }
.period-date { color: var(--text-secondary); font-family: monospace; }
.period-pillars { color: var(--accent-gold); font-family: monospace; margin-right: 4px; }

/* ── 结果行：月/周/日分项评分 + 市场标签 ── */
.period-scores { display: flex; gap: 6px; margin: 6px 0 2px; flex-wrap: wrap; }
.period-score {
  font-size: 11px;
  font-family: monospace;
  padding: 1px 7px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
}
.period-score em { font-style: normal; margin-right: 3px; opacity: 0.75; }
.market-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.2);
  color: var(--text-secondary);
  flex-shrink: 0;
}

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
