<template>
  <div class="scan-page">
    <van-nav-bar title="股票扫描" left-arrow @click-left="$router.back()" />

    <div class="scan-layout">
      <!-- 左栏：操作 + 概况 + 结果列表 -->
      <div class="col-main">
        <div class="scan-controls">
          <van-search v-model="keyword" placeholder="搜索股票名称/代码" @search="onSearch" class="search-box" />
          <div class="btn-col">
            <van-button type="primary" size="small" @click="onScan" :loading="loading" class="scan-btn">
              全市场扫描
            </van-button>
          </div>
        </div>

        <!-- 数据管理：快照 / 日均线 / 周均线，三个独立更新入口（手机端同样可见） -->
        <div class="data-card">
          <div class="card-title">数据管理</div>
          <div class="data-row">
            <div class="data-meta">
              <span class="data-name">行情快照</span>
              <span class="data-sub">
                {{ syncState.lastSuccessDate || '从未同步' }} · {{ syncState.spotCount || 0 }}只
                <template v-if="syncState.lastSource"> · {{ syncState.lastSource }}</template>
              </span>
              <span v-if="syncing" class="data-prog syncing-txt">{{ syncState.spotPhase || '同步中' }}</span>
              <span v-else-if="syncState.spotStatus === 'failed'" class="data-prog err-txt">上次失败，可重试</span>
            </div>
            <van-button size="small" type="primary" plain :loading="syncing" @click="onSync">
              {{ syncing ? '同步中' : '更新快照' }}
            </van-button>
          </div>
          <div class="data-row">
            <div class="data-meta">
              <span class="data-name">日均线 144/288</span>
              <span class="data-sub">
                {{ syncState.maTradeDate || '从未同步' }} · {{ syncState.maCount || 0 }}只
              </span>
              <span v-if="maSyncing" class="data-prog syncing-txt">
                {{ syncState.maPhase || '拉取日K中' }}
              </span>
              <span v-else-if="syncState.maStatus === 'failed'" class="data-prog err-txt">
                {{ syncState.maLastError || '上次失败' }}
              </span>
            </div>
            <van-button size="small" type="warning" plain :loading="maSyncing"
              :disabled="maWeekSyncing" @click="onSyncMa('day')">
              {{ maSyncing ? '同步中' : (maWeekSyncing ? '排队中' : '更新日均线') }}
            </van-button>
          </div>
          <div class="data-row">
            <div class="data-meta">
              <span class="data-name">周均线 144/288</span>
              <span class="data-sub">
                {{ syncState.maWeekTradeDate || '从未同步' }} · {{ syncState.maWeekCount || 0 }}只
              </span>
              <span v-if="maWeekSyncing" class="data-prog syncing-txt">
                {{ syncState.maWeekPhase || '拉取周K中' }}
              </span>
              <span v-else-if="syncState.maWeekStatus === 'failed'" class="data-prog err-txt">
                {{ syncState.maWeekLastError || '上次失败' }}
              </span>
            </div>
            <van-button size="small" type="warning" plain :loading="maWeekSyncing"
              :disabled="maSyncing" @click="onSyncMa('week')">
              {{ maWeekSyncing ? '同步中' : (maSyncing ? '排队中' : '更新周均线') }}
            </van-button>
          </div>
          <p class="settings-tip" style="margin:4px 0 0">
            增量更新：只拉落后的票，已最新的自动跳过，进度随时退出不丢；日/周线串行执行。
          </p>
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
          <div class="filter-row">
            <span class="filter-label">日均线</span>
            <div class="chip-group">
              <span
                class="filter-chip" :class="{ active: selectedMa.includes(144) }"
                @click="toggleMa(144)"
              >回踩144日线</span>
              <span
                class="filter-chip" :class="{ active: selectedMa.includes(288) }"
                @click="toggleMa(288)"
              >回踩288日线</span>
            </div>
          </div>
          <div class="filter-row">
            <span class="filter-label">周均线</span>
            <div class="chip-group">
              <span
                class="filter-chip" :class="{ active: selectedMaWeek.includes(144) }"
                @click="toggleMaWeek(144)"
              >回踩144周线</span>
              <span
                class="filter-chip" :class="{ active: selectedMaWeek.includes(288) }"
                @click="toggleMaWeek(288)"
              >回踩288周线</span>
            </div>
          </div>
          <div v-if="selectedMa.length || selectedMaWeek.length" class="filter-row">
            <span class="filter-label">回踩容差</span>
            <select v-model="maTol" class="tol-select">
              <option :value="0.01">±1%</option>
              <option :value="0.03">±3%</option>
              <option :value="0.05">±5%</option>
            </select>
            <span class="filter-hint">距离均线在此范围内，且前20日/周曾站上均线</span>
          </div>
          <div class="filter-row">
            <span class="filter-label">勾选阈值</span>
            <van-stepper v-model="autoThreshold" :min="0" :max="100" :step="5" integer
              button-size="26" class="threshold-stepper" @change="persistThreshold" />
            <span class="filter-hint">综合分 ≥ 此值可一键选中（当前结果集内）</span>
          </div>
        </div>

        <div v-if="scanResult" class="scan-summary">
          <div class="summary-row">
            <van-tag plain type="primary">日期 {{ scanResult.date }}</van-tag>
            <van-tag plain :type="scanResult.dataSource === 'spot' ? 'success' : 'warning'">
              {{ scanResult.dataSource === 'spot' ? '全市场快照' : '名称库(无价格)' }}
            </van-tag>
            <van-tag v-if="scanResult.maFilter && scanResult.maFilter.length" plain type="primary">
              回踩{{ scanResult.maFilter.join('/') }}日线 ±{{ Math.round(scanResult.maTol * 100) }}%
            </van-tag>
            <van-tag v-if="scanResult.maWeekFilter && scanResult.maWeekFilter.length" plain type="warning">
              回踩{{ scanResult.maWeekFilter.join('/') }}周线 ±{{ Math.round(scanResult.maTol * 100) }}%
            </van-tag>
            <van-tag v-if="scanResult.maTradeDate" plain type="default">
              日均线 {{ scanResult.maTradeDate }}
            </van-tag>
            <van-tag v-if="scanResult.maWeekTradeDate" plain type="default">
              周均线 {{ scanResult.maWeekTradeDate }}
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
            <span>扫描 {{ scanResult.totalScanned }} 只 | 命中 {{ scanResult.totalMatched }} 只</span>
            <van-button
              size="mini" plain type="primary" class="quote-refresh-btn"
              :loading="refreshingQuotes" @click="onRefreshQuotes"
            >
              刷新行情
            </van-button>
          </div>
        </div>

        <div v-if="errorMsg" class="error-state">
          <van-empty image="error" :description="errorMsg">
            <van-button v-if="maSyncPeriod" size="small" type="primary" @click="onSyncMa(maSyncPeriod)">
              立即更新{{ maSyncPeriod === 'week' ? '周均线' : '日均线' }}数据
            </van-button>
            <van-button v-if="spotNeeded" size="small" plain @click="onSync">立即更新快照</van-button>
          </van-empty>
        </div>

        <div v-if="searchResults.length" class="search-section">
          <div class="section-title">搜索结果（本地综合评分）</div>
          <div v-for="s in searchResults" :key="s.symbol" class="stock-row" @click="onPickStock(s)">
            <div class="stock-top">
              <div class="stock-main">
                <span class="code">{{ s.symbol }}</span>
                <span class="name">{{ s.name }}</span>
                <span v-if="s.element" class="elem" :class="'element-' + s.element" :title="s.stemNature">
                  {{ s.stemLabel || s.element }}
                </span>
                <span v-if="s.godLabel" class="god-tag-mini">{{ s.godLabel }}</span>
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
          <div class="section-title">
            命理评分排行
            <span class="title-hint">勾选后加入自选，次日收盘自动算胜率</span>
          </div>
          <van-checkbox-group v-model="checkedSymbols" @update:model-value="onPickChange">
            <div v-for="s in scanResults" :key="s.symbol" class="stock-row scan-pick-row">
              <van-checkbox :name="s.symbol" shape="square" icon-size="18" class="row-check" />
              <div class="row-body">
              <div class="stock-top">
                <div class="stock-main">
                  <span class="code">{{ s.symbol }}</span>
                  <span class="name">{{ s.name }}</span>
                  <span class="elem" :class="'element-' + s.element" :title="s.stemNature">
                    {{ s.stemLabel || s.element }}
                  </span>
                  <span v-if="s.godLabel" class="god-tag-mini">{{ s.godLabel }}</span>
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
            <!-- 144/288 均线距离标签（均线同步后下发） -->
            <div v-if="s.dist144 !== undefined || s.dist288 !== undefined" class="ma-tags">
              <span v-if="s.dist144 !== undefined" class="ma-tag" :class="maTagClass(s.dist144)">
                144线 {{ fmtPct(s.dist144) }}
              </span>
              <span v-if="s.dist288 !== undefined" class="ma-tag" :class="maTagClass(s.dist288)">
                288线 {{ fmtPct(s.dist288) }}
              </span>
              <span v-if="s.maDate" class="ma-date">日K {{ s.maDate }}</span>
            </div>
            <!-- 144/288 周均线距离标签（周均线同步后下发） -->
            <div v-if="s.distWeek144 !== undefined || s.distWeek288 !== undefined" class="ma-tags">
              <span v-if="s.distWeek144 !== undefined" class="ma-tag" :class="maTagClass(s.distWeek144)">
                144周线 {{ fmtPct(s.distWeek144) }}
              </span>
              <span v-if="s.distWeek288 !== undefined" class="ma-tag" :class="maTagClass(s.distWeek288)">
                288周线 {{ fmtPct(s.distWeek288) }}
              </span>
              <span v-if="s.maWeekDate" class="ma-date">周K {{ s.maWeekDate }}</span>
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
              </div><!-- /row-body -->
            </div>
          </van-checkbox-group>
        </div>

        <div class="pick-bar" v-if="scanResults.length">
          <span class="pick-count">已选 {{ checkedSymbols.length }} 只</span>
          <van-button size="small" plain @click="clearPick">清空</van-button>
          <van-button size="small" plain type="primary" @click="autoPick">
            全选≥{{ autoThreshold }}分
          </van-button>
          <van-button size="small" type="primary" :disabled="!checkedSymbols.length"
            :loading="adding" @click="onAddWatch">
            加入自选
          </van-button>
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

        <div class="side-card tips-card">
          <div class="card-title">数据独立</div>
          <p class="tip-text">APP 启动时自动后台拉取全市场行情与日/周均线数据（见左侧「数据管理」），无需连接电脑。行情优先 BaoStock 直连，东财/腾讯/新浪自动兜底。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { showToast } from 'vant'
import {
  scanStocks, searchStocks, getSectors, getSyncStatus, triggerSync, triggerMaSync,
} from '../api'
import { addWatchlist } from '../lib/watchlist.js'
import { fetchQuotes } from '../lib/market/quote.js'

const keyword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const scanResult = ref(null)
const refreshingQuotes = ref(false)
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
// 144/288 均线附加指标（空数组=不启用）；日/周独立
const selectedMa = ref([])
const selectedMaWeek = ref([])
const maTol = ref(0.03)
// 错误页一键更新入口：maSyncPeriod='day'|'week'|null，spotNeeded=快照缺失
const maSyncPeriod = ref(null)
const spotNeeded = ref(false)

// ── 自选勾选：一键阈值（localStorage 持久化，默认80）+ 选中集合 ──
const autoThreshold = ref((() => {
  const v = parseInt(localStorage.getItem('wl_auto_threshold'), 10)
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 80
})())
const checkedSymbols = ref([])
const autoPickedSet = ref(new Set())
const adding = ref(false)

function persistThreshold(v) {
  const n = Math.min(100, Math.max(0, parseInt(v, 10) || 0))
  autoThreshold.value = n
  localStorage.setItem('wl_auto_threshold', String(n))
}

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

function toggleMa(w) {
  const i = selectedMa.value.indexOf(w)
  if (i === -1) selectedMa.value.push(w)
  else selectedMa.value.splice(i, 1)
}

function toggleMaWeek(w) {
  const i = selectedMaWeek.value.indexOf(w)
  if (i === -1) selectedMaWeek.value.push(w)
  else selectedMaWeek.value.splice(i, 1)
}

// 均线距离展示：带符号百分比；命中容差区间时高亮
function fmtPct(dist) {
  return (dist >= 0 ? '+' : '') + (dist * 100).toFixed(1) + '%'
}
function maTagClass(dist) {
  const tol = scanResult.value?.maTol ?? maTol.value
  return Math.abs(dist) <= tol + 1e-9 ? 'ma-near' : 'ma-far'
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
  if (selectedMa.value.length) params.ma = selectedMa.value.join(',')
  if (selectedMaWeek.value.length) params.maw = selectedMaWeek.value.join(',')
  if (selectedMa.value.length || selectedMaWeek.value.length) params.ma_tol = maTol.value
  return params
}

const syncState = ref({})
const syncing = ref(false)
const maSyncing = ref(false)
const maWeekSyncing = ref(false)
let syncTimer = null

function sectorPct(e) {
  if (!sectorCounts.value) return 0
  const max = Math.max(...Object.values(sectorCounts.value), 1)
  return Math.round((sectorCounts.value[e] / max) * 100)
}

async function refreshSyncStatus(silent = true) {
  try {
    const st = await getSyncStatus()
    const wasSyncing = syncing.value
    const wasMaSyncing = maSyncing.value
    const wasMaWeekSyncing = maWeekSyncing.value
    syncing.value = st.spotStatus === 'syncing'
    maSyncing.value = st.maStatus === 'syncing'
    maWeekSyncing.value = st.maWeekStatus === 'syncing'
    syncState.value = st
    // 快照同步从进行中变为结束 → 刷新分布图，并提示
    if (wasSyncing && !syncing.value) {
      loadSectors()
      showToast(st.spotLastError ? '快照同步失败' : '快照同步完成')
    }
    // 日均线同步结束提示
    if (wasMaSyncing && !maSyncing.value) {
      showToast(st.maLastError ? '日均线同步失败' : '日均线同步完成')
    }
    // 周均线同步结束提示
    if (wasMaWeekSyncing && !maWeekSyncing.value) {
      showToast(st.maWeekLastError ? '周均线同步失败' : '周均线同步完成')
    }
  } catch {
    if (!silent) showToast('无法获取同步状态')
  }
}

function startSyncPolling() {
  stopSyncPolling()
  syncTimer = setInterval(() => {
    refreshSyncStatus()
    if (!syncing.value && !maSyncing.value && !maWeekSyncing.value) stopSyncPolling()
  }, 2000)
}

function stopSyncPolling() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
}

async function onSync() {
  try {
    const r = await triggerSync()
    showToast(r.message || '已触发')
    if (r.skipped) return
    syncing.value = true
    startSyncPolling()
  } catch (e) {
    showToast('触发失败：' + (e.message || ''))
  }
}

async function onSyncMa(period = 'day') {
  const isWeek = period === 'week'
  try {
    // 日常更新走增量（只拉缺失/过期标的）；全量强制重拉由同步服务按交易日/周自动判断
    const r = await triggerMaSync(isWeek ? 'week' : 'day', false)
    if (r && r.ok === false) {
      // 跨周期互斥：另一周期同步中，自动链完成后会衔接
      showToast(r.message || '另一周期均线同步中，请稍候')
      return
    }
    showToast(r.message || (isWeek ? '周均线同步已开始，约10分钟' : '日均线同步已开始，约3~5分钟'))
    if (r.skipped) return
    if (isWeek) maWeekSyncing.value = true
    else maSyncing.value = true
    maSyncPeriod.value = null
    startSyncPolling()
  } catch (e) {
    showToast('触发失败：' + (e.message || ''))
  }
}

async function loadSectors() {
  try {
    sectorCounts.value = await getSectors()
  } catch { /* 忽略：分布图非核心功能 */ }
}

// ── 入池勾选 ─────────────────────────────────────────────
// 勾选集合变化：用户取消勾选的票从一键集合移除
function onPickChange(names) {
  const cur = new Set(names)
  for (const sym of [...autoPickedSet.value]) {
    if (!cur.has(sym)) autoPickedSet.value.delete(sym)
  }
}

function clearPick() {
  checkedSymbols.value = []
  autoPickedSet.value.clear()
}

// 一键勾选：只在当前已过全部筛选的结果集内，按综合分阈值
function autoPick() {
  const t = autoThreshold.value
  const hit = scanResults.value.filter((s) => (s.score ?? -1e9) >= t)
  checkedSymbols.value = hit.map((s) => s.symbol)
  autoPickedSet.value = new Set(hit.map((s) => s.symbol))
  if (!hit.length) {
    showToast(`当前结果集内没有综合分 ≥ ${t} 的票`)
    return
  }
  showToast(`已按当前条件选中${hit.length}只（≥${t}分）`)
}

// 入池时记录的筛选快照（label 用于条件分组战绩）
function filterSnapshot(pickedBy) {
  const parts = [periods.value.map((k) => PERIOD_LABEL[k]).join('')]
  if (selectedElements.value.length) parts.push(selectedElements.value.join(''))
  if (selectedMarkets.value.length) {
    parts.push('市场' + selectedMarkets.value.map((m) => (m === '北交所' ? '北' : m)).join(''))
  }
  if (minPrice.value !== '' || maxPrice.value !== '') {
    parts.push(`价${minPrice.value || '0'}~${maxPrice.value || '∞'}`)
  }
  for (const w of selectedMa.value) parts.push(`日${w}`)
  for (const w of selectedMaWeek.value) parts.push(`周${w}`)
  const baseLabel = parts.join('·')
  return {
    label: pickedBy === 'auto' ? `${baseLabel}·自动≥${autoThreshold.value}` : baseLabel,
    filters: {
      elements: [...selectedElements.value],
      markets: [...selectedMarkets.value],
      minPrice: minPrice.value !== '' ? Number(minPrice.value) : null,
      maxPrice: maxPrice.value !== '' ? Number(maxPrice.value) : null,
      ma: [...selectedMa.value],
      maw: [...selectedMaWeek.value],
      maTol: maTol.value,
      periods: [...periods.value],
      pickedBy,
      threshold: pickedBy === 'auto' ? autoThreshold.value : null,
    },
  }
}

async function onAddWatch() {
  if (!checkedSymbols.value.length) return
  if (!scanResult.value) {
    showToast('扫描结果已失效，请重新扫描')
    return
  }
  const sel = new Set(checkedSymbols.value)
  const picked = scanResults.value.filter((s) => sel.has(s.symbol))
  if (!picked.length) {
    showToast('勾选的票不在当前结果集内，请重新扫描')
    return
  }
  const periodPillars = (scanResult.value.periods || []).map((p) => ({
    key: p.key, label: p.label, date: p.date, pillars: p.pillars,
  }))
  const common = {
    periods: [...periods.value],
    pillars: scanResult.value.pillars || '',
    periodPillars,
  }
  const autoItems = picked.filter((s) => autoPickedSet.value.has(s.symbol)).map((s) => ({ ...s, source: 'auto' }))
  const manualItems = picked.filter((s) => !autoPickedSet.value.has(s.symbol)).map((s) => ({ ...s, source: 'manual' }))
  adding.value = true
  try {
    const calls = []
    if (autoItems.length) {
      const snap = filterSnapshot('auto')
      calls.push(addWatchlist(autoItems, { ...common, source: 'auto', filtersLabel: snap.label, filters: snap.filters }))
    }
    if (manualItems.length) {
      const snap = filterSnapshot('manual')
      calls.push(addWatchlist(manualItems, { ...common, source: 'manual', filtersLabel: snap.label, filters: snap.filters }))
    }
    const rs = await Promise.all(calls)
    const added = rs.reduce((n, r) => n + r.added, 0)
    const dup = rs.reduce((a, r) => a.concat(r.duplicated), [])
    if (added > 0) {
      showToast(`已加入自选 ${added} 只，明日收盘自动结算${dup.length ? `（${dup.length}只已在池中）` : ''}`)
      clearPick()
    } else {
      showToast(`勾选的票都已在自选池中（${dup.slice(0, 3).join('、')}${dup.length > 3 ? '等' : ''}）`)
    }
  } catch (e) {
    showToast('加入自选失败：' + (e.message || '本地数据异常'))
  } finally {
    adding.value = false
  }
}

async function onScan() {
  if (!periods.value.length) {
    showToast('请至少勾选一个周期效应')
    return
  }
  loading.value = true
  errorMsg.value = ''
  maSyncPeriod.value = null
  spotNeeded.value = false
  try {
    const data = await scanStocks(buildScanParams())
    scanResult.value = data
    scanResults.value = data.results || []
    searchResults.value = []
    clearPick()
    if (!syncing.value) loadSectors()
  } catch (e) {
    scanResults.value = []
    scanResult.value = null
    // 本地业务错误展示原文，并给出对应一键同步入口（日/周均线或快照）
    const msg = e.message || ''
    if (e.code === 'MA_WEEK_NOT_SYNCED' || /周均线/.test(msg)) maSyncPeriod.value = 'week'
    else if (e.code === 'MA_NOT_SYNCED' || /均线/.test(msg)) maSyncPeriod.value = 'day'
    spotNeeded.value = /快照|为空/.test(msg)
    errorMsg.value = msg || '扫描失败'
  } finally {
    loading.value = false
  }
}

// 按当前扫描结果行的标的批量拉实时报价，更新行价格（不重新扫描/评分）
async function onRefreshQuotes() {
  const rows = scanResult.value && scanResult.value.results
  if (!rows || !rows.length) {
    showToast('当前无结果可刷新')
    return
  }
  refreshingQuotes.value = true
  try {
    const quotes = await fetchQuotes(rows.map((r) => r.symbol))
    let n = 0
    for (const r of rows) {
      const q = quotes.get(r.symbol)
      if (!q) continue
      r.price = q.price
      if (q.changePct != null) r.changePct = q.changePct
      n++
    }
    if (!n) showToast('未取到实时行情（网络异常或停牌）')
    else showToast(`行情已刷新（${n}/${rows.length} 只）`)
  } catch (e) {
    showToast('刷新失败：' + (e.message || '网络异常'))
  } finally {
    refreshingQuotes.value = false
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
    // searchStocks 已内置本地评分（按勾选周期）
    searchResults.value = await searchStocks(keyword.value.trim(), periods.value)
    scanResults.value = []
    clearPick()
  } catch (e) {
    errorMsg.value = '搜索失败：' + (e.message || '本地数据未就绪')
  } finally {
    loading.value = false
  }
}

function onPickStock(s) {
  keyword.value = s.name
  searchResults.value = []
}

function scoreClass(score) {
  if (score >= 45) return 'score-top'
  if (score >= 15) return 'score-good'
  if (score >= -10) return 'score-neutral'
  if (score >= -35) return 'score-warn'
  return 'score-bad'
}

onMounted(async () => {
  await refreshSyncStatus()
  loadSectors()
  // APP启动时后台自动同步可能已在进行 → 自动开始轮询进度
  if (syncing.value || maSyncing.value || maWeekSyncing.value) startSyncPolling()
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
  .scan-controls, .data-card, .filter-card, .scan-summary, .search-section, .scan-results,
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

/* ── 数据管理卡片：快照 / 日均线 / 周均线 ── */
.data-card {
  margin: 0 12px 12px;
  padding: 10px 12px;
  background: var(--bg-card);
  border-radius: 10px;
}
.data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
}
.data-row + .data-row { border-top: 1px solid rgba(255,255,255,0.06); }
.data-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.data-name { font-size: 13px; font-weight: bold; color: var(--text-primary); }
.data-sub { font-size: 11px; color: var(--text-secondary); }
.data-prog { font-size: 11px; font-family: monospace; }

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

/* ── 144/288 均线距离标签 ── */
.ma-tags { display: flex; gap: 6px; margin: 6px 0 2px; flex-wrap: wrap; align-items: center; }
.ma-tag {
  font-size: 11px;
  font-family: monospace;
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--text-secondary);
  background: rgba(255,255,255,0.06);
}
.ma-tag.ma-near {
  color: #fff;
  border-color: #e94560;
  background: rgba(233,69,96,0.28);
  font-weight: bold;
}
.ma-date { font-size: 10px; color: var(--text-secondary); }

.tol-select {
  font-size: 12px;
  color: var(--text-primary);
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  padding: 3px 4px;
}
.sync-subtitle {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.08);
  font-size: 13px;
  font-weight: bold;
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
.stat-row {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.quote-refresh-btn { margin-left: 8px; }

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

.settings-tip { font-size: 12px; color: var(--text-secondary); margin-top: 8px; line-height: 1.5; }

/* ── 勾选入池 ── */
.title-hint { font-size: 11px; font-weight: normal; color: var(--text-secondary); margin-left: 8px; }
.threshold-stepper { margin: 0 4px; flex-shrink: 0; }
.stock-row.scan-pick-row { display: flex; align-items: flex-start; gap: 10px; }
.row-check { padding-top: 2px; flex-shrink: 0; }
.row-body { flex: 1; min-width: 0; }
.god-tag-mini {
  font-size: 11px; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;
  color: #d8b56a; border: 1px solid rgba(216,181,106,0.4);
}
.pick-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 100;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: var(--bg-card);
  border-top: 1px solid rgba(255,255,255,0.1);
}
.pick-count { font-size: 13px; font-weight: bold; margin-right: auto; }
.scan-layout { padding-bottom: 70px; }
</style>
