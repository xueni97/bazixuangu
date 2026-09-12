<template>
  <div class="scan-page">
    <van-nav-bar title="股票扫描" left-arrow @click-left="$router.back()" />

    <div class="scan-controls">
      <van-search v-model="keyword" placeholder="搜索股票名称/代码" @search="onSearch" />
      <van-button type="primary" size="small" @click="onScan" :loading="loading" class="scan-btn">
        全市场扫描
      </van-button>
    </div>

    <div v-if="scanResult" class="scan-summary">
      <div class="summary-row">
        <van-tag plain type="primary">日期 {{ scanResult.date }}</van-tag>
        <van-tag plain>四柱 {{ scanResult.pillars }}</van-tag>
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

    <div v-if="searchResults.length" class="search-section">
      <div class="section-title">搜索结果</div>
      <div v-for="s in searchResults" :key="s.symbol" class="stock-row" @click="onPickStock(s)">
        <span class="code">{{ s.symbol }}</span>
        <span class="name">{{ s.name }}</span>
        <span v-if="s.element" class="elem" :class="'element-' + s.element">{{ s.element }}</span>
      </div>
    </div>

    <div v-if="scanResults.length" class="scan-results">
      <div class="section-title">命理评分排行</div>
      <van-pull-refresh v-model="refreshing" @refresh="onScan">
        <div v-for="s in scanResults" :key="s.symbol" class="stock-row">
          <div class="stock-main">
            <span class="code">{{ s.symbol }}</span>
            <span class="name">{{ s.name }}</span>
            <span class="elem" :class="'element-' + s.element">{{ s.element }}</span>
          </div>
          <div class="stock-score">
            <div class="score-num" :class="scoreClass(s.score)">{{ s.score > 0 ? '+' : '' }}{{ s.score }}</div>
            <div class="score-level">{{ s.level }}</div>
          </div>
          <div class="stock-reason">{{ s.reason }}</div>
        </div>
      </van-pull-refresh>
    </div>

    <div v-if="loading" class="loading">
      <van-loading type="spinner" />扫描中...
    </div>

    <div v-if="!loading && !scanResults.length && !searchResults.length" class="empty-state">
      <van-icon name="search" size="48" color="#555" />
      <p>点击「全市场扫描」开始命理选股</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { showToast } from 'vant'
import { scanStocks, searchStocks } from '../api'
import { StockElementAnalyzer, YuanhaiDecisionModel, BaziEngine } from '../core'

const keyword = ref('')
const loading = ref(false)
const refreshing = ref(false)
const scanResult = ref(null)
const scanResults = ref([])
const searchResults = ref([])

async function onScan() {
  loading.value = true
  refreshing.value = true
  try {
    const data = await scanStocks({ minScore: 10, limit: 200 })
    scanResult.value = data
    scanResults.value = data.results || []
    searchResults.value = []
  } catch (e) {
    showToast('扫描失败：' + (e.message || '后端未启动'))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function onSearch() {
  if (!keyword.value.trim()) return
  loading.value = true
  try {
    const results = await searchStocks(keyword.value.trim())
    // 本地计算五行
    const pillars = BaziEngine.from_datetime(new Date())
    const analysis = YuanhaiDecisionModel.analyze(pillars)
    searchResults.value = results.map(s => {
      const elem = StockElementAnalyzer.combined_element(s.name)
      const info = YuanhaiDecisionModel.stock_score(elem, analysis, s.name)
      return { ...s, element: elem, score: info.score, level: info.level, reason: info.reason }
    })
    scanResults.value = []
  } catch (e) {
    showToast('搜索失败：' + (e.message || '后端未启动'))
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
</script>

<style scoped>
.scan-page { padding-bottom: 40px; }

.scan-controls {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  align-items: center;
}
.scan-btn { flex-shrink: 0; }

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
.stock-main { display: flex; gap: 8px; align-items: center; }
.code { font-size: 13px; color: var(--text-secondary); font-family: monospace; }
.name { font-size: 15px; font-weight: bold; flex: 1; }
.elem { font-size: 12px; padding: 2px 6px; border-radius: 3px; }

.stock-score { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.score-num { font-size: 18px; font-weight: bold; }
.score-level { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); }
.score-top { color: #4caf50; }
.score-good { color: #8bc34a; }
.score-neutral { color: #ffc107; }
.score-warn { color: #ff9800; }
.score-bad { color: #f44336; }
.stock-reason { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

.loading { text-align: center; padding: 40px; display: flex; align-items: center; justify-content: center; gap: 8px; }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
.empty-state p { margin-top: 12px; font-size: 14px; }
</style>
