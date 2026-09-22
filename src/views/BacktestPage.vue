<template>
  <div class="bt-page">
    <van-nav-bar title="策略回测" left-arrow @click-left="$router.back()" />

    <!-- 模型定义区 -->
    <div class="section-card">
      <div class="card-title">模型定义</div>

      <van-cell-group inset>
        <van-field v-model="model.name" label="模型名称" placeholder="如：月周日·日288·≥70" />
      </van-cell-group>

      <!-- 周期 -->
      <div class="filter-row">
        <span class="filter-label">周期</span>
        <div class="chip-group">
          <span
            v-for="p in periodOptions" :key="p.value"
            class="chip" :class="{ active: model.params.periods.includes(p.value) }"
            @click="toggleArr(model.params.periods, p.value)"
          >{{ p.label }}</span>
        </div>
      </div>

      <!-- 五行 -->
      <div class="filter-row">
        <span class="filter-label">五行</span>
        <div class="chip-group">
          <span
            v-for="e in elementOptions" :key="e"
            class="chip elem" :class="['el-' + e, { active: model.params.elements.includes(e) }]"
            @click="toggleArr(model.params.elements, e)"
          >{{ e }}</span>
        </div>
      </div>

      <!-- 市场 -->
      <div class="filter-row">
        <span class="filter-label">市场</span>
        <div class="chip-group">
          <span
            v-for="m in marketOptions" :key="m"
            class="chip" :class="{ active: model.params.markets.includes(m) }"
            @click="toggleArr(model.params.markets, m)"
          >{{ m }}</span>
        </div>
      </div>

      <!-- 价格区间 -->
      <div class="filter-row">
        <span class="filter-label">价格</span>
        <input v-model.number="model.params.minPrice" type="number" class="num-input" placeholder="最低" />
        <span class="dash">~</span>
        <input v-model.number="model.params.maxPrice" type="number" class="num-input" placeholder="最高" />
      </div>

      <!-- 均线 -->
      <div class="filter-row">
        <span class="filter-label">均线</span>
        <div class="chip-group">
          <span
            v-for="ma in [144, 288]" :key="ma"
            class="chip" :class="{ active: model.params.ma.includes(ma) }"
            @click="toggleArr(model.params.ma, ma)"
          >MA{{ ma }}</span>
        </div>
        <span class="filter-label">容差</span>
        <input v-model.number="model.params.maTol" type="number" step="0.01" class="num-input small" />
      </div>

      <!-- 参数 steppers -->
      <div class="param-grid">
        <div class="param-item">
          <span class="param-label">综合分≥</span>
          <van-stepper v-model="model.threshold" :min="0" :max="100" integer />
        </div>
        <div class="param-item">
          <span class="param-label">买入数</span>
          <van-stepper v-model="model.topN" :min="1" :max="50" integer />
        </div>
        <div class="param-item">
          <span class="param-label">持仓天</span>
          <van-stepper v-model="model.holdDays" :min="1" :max="30" integer />
        </div>
        <div class="param-item">
          <span class="param-label">初始资金</span>
          <van-stepper v-model="model.initialCapital" :min="100000" :step="100000" integer />
        </div>
      </div>

      <!-- 起始日期 -->
      <div class="filter-row">
        <span class="filter-label">起始日</span>
        <input v-model="model.startDate" type="date" class="date-input" />
      </div>

      <div class="btn-row">
        <van-button type="primary" size="small" @click="saveModel">保存模型</van-button>
        <van-button type="success" size="small" :loading="running" @click="onRun">开始回测</van-button>
      </div>
    </div>

    <!-- 已保存模型 -->
    <div v-if="savedModels.length" class="section-card">
      <div class="card-title">已保存模型</div>
      <div v-for="m in savedModels" :key="m.id" class="saved-model" @click="loadModel(m)">
        <span class="sm-name">{{ m.name }}</span>
        <span class="sm-params">
          {{ m.params.periods.join('/') }} · ≥{{ m.threshold }} · top{{ m.topN }} · {{ m.holdDays }}天
        </span>
        <van-icon name="delete-o" class="sm-del" @click.stop="delModel(m.id)" />
      </div>
    </div>

    <!-- 进度区 -->
    <div v-if="running" class="section-card">
      <van-loading type="spinner" />
      <span class="prog-text">
        {{ progress.phase === 'fetching' ? '拉取K线' : progress.phase === 'backtesting' ? '逐日回测' : '统计中' }}
        {{ progress.done }}/{{ progress.total }}
      </span>
    </div>

    <!-- 回测结果 -->
    <template v-if="result && result.status !== 'empty'">
      <!-- 统计卡 -->
      <div class="section-card">
        <div class="card-title">回测统计</div>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-val" :class="pnlClass(result.stats.totalReturn)">
              {{ fmt(result.stats.totalReturn) }}%
            </span>
            <span class="stat-lbl">总收益</span>
          </div>
          <div class="stat-item">
            <span class="stat-val" :class="pnlClass(result.stats.annualizedReturn)">
              {{ fmt(result.stats.annualizedReturn) }}%
            </span>
            <span class="stat-lbl">年化</span>
          </div>
          <div class="stat-item">
            <span class="stat-val" :class="rateClass(result.stats.winRate)">
              {{ result.stats.winRate == null ? '—' : result.stats.winRate + '%' }}
            </span>
            <span class="stat-lbl">胜率</span>
          </div>
          <div class="stat-item">
            <span class="stat-val down">-{{ result.stats.maxDrawdown }}%</span>
            <span class="stat-lbl">最大回撤</span>
          </div>
          <div class="stat-item">
            <span class="stat-val">{{ result.stats.tradeCount }}</span>
            <span class="stat-lbl">交易笔数</span>
          </div>
          <div class="stat-item">
            <span class="stat-val">{{ result.stats.avgHold ?? '—' }}</span>
            <span class="stat-lbl">平均持仓天</span>
          </div>
        </div>
      </div>

      <!-- 曲线区 -->
      <div class="section-card">
        <van-tabs v-model:active="chartTab" shrink>
          <van-tab title="日线"> <canvas ref="dailyCanvas" class="bt-canvas"></canvas> </van-tab>
          <van-tab title="周线"> <canvas ref="weeklyCanvas" class="bt-canvas"></canvas> </van-tab>
          <van-tab title="月线"> <canvas ref="monthlyCanvas" class="bt-canvas"></canvas> </van-tab>
        </van-tabs>
      </div>

      <!-- 交易明细 -->
      <div class="section-card">
        <div class="card-title" @click="showTrades = !showTrades">
          交易明细（{{ result.trades.length }}笔）
          <van-icon :name="showTrades ? 'arrow-up' : 'arrow-down'" class="ml-auto" />
        </div>
        <div v-show="showTrades" class="trades-list">
          <div v-for="(t, i) in result.trades" :key="i" class="trade-row">
            <span class="t-name">{{ t.name }}</span>
            <span class="t-date">{{ t.entryDate }}→{{ t.exitDate }}</span>
            <span class="t-hold">{{ t.holdDays }}天</span>
            <span class="t-pnl" :class="pnlClass(t.pnlPct)">{{ fmt(t.pnlPct) }}%</span>
            <span class="t-reason">{{ t.exitReason }}</span>
          </div>
        </div>
      </div>
    </template>

    <div v-else-if="result && result.status === 'empty'" class="section-card empty-result">
      <van-icon name="info-o" size="32" />
      <p>{{ result.reason || '无数据' }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch, nextTick } from 'vue'
import { showToast } from 'vant'
import { runBacktest } from '../lib/backtest/engine.js'
import { drawEquityCurve, drawHistogram } from '../lib/backtest/canvasChart.js'

const periodOptions = [
  { value: 'monthly', label: '月' },
  { value: 'weekly', label: '周' },
  { value: 'daily', label: '日' },
]
const elementOptions = ['木', '火', '土', '金', '水']
const marketOptions = ['全部', '沪', '深', '北交所']

const model = reactive({
  id: null,
  name: '月周日·日288·≥70',
  params: {
    periods: ['monthly', 'weekly', 'daily'],
    elements: [],
    markets: ['全部'],
    minPrice: null,
    maxPrice: null,
    ma: [288],
    maTol: 0.03,
  },
  threshold: 70,
  topN: 10,
  holdDays: 5,
  initialCapital: 1000000,
  startDate: getDefaultStartDate(),
})

const savedModels = ref([])
const running = ref(false)
const progress = ref({ phase: '', done: 0, total: 0 })
const result = ref(null)
const chartTab = ref(0)
const showTrades = ref(false)
const dailyCanvas = ref(null)
const weeklyCanvas = ref(null)
const monthlyCanvas = ref(null)

function getDefaultStartDate() {
  const d = new Date()
  d.setMonth(d.getMonth() - 6)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toggleArr(arr, val) {
  const idx = arr.indexOf(val)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(val)
}

function fmt(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v
}
function pnlClass(v) {
  if (v == null) return ''
  if (v > 0.01) return 'up'
  if (v < -0.01) return 'down'
  return 'flat'
}
function rateClass(w) {
  if (w == null) return ''
  if (w >= 50) return 'up'
  return 'down'
}

// ── 模型持久化 ──
const STORAGE_KEY = 'backtest_models'

function loadSavedModels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    savedModels.value = raw ? JSON.parse(raw) : []
  } catch { savedModels.value = [] }
}

function saveModel() {
  if (!model.name) { showToast('请输入模型名称'); return }
  const m = JSON.parse(JSON.stringify(model))
  m.id = m.id || `bt_${Date.now()}`
  const idx = savedModels.value.findIndex((x) => x.id === m.id)
  if (idx >= 0) savedModels.value[idx] = m
  else savedModels.value.push(m)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedModels.value))
  showToast('模型已保存')
}

function loadModel(m) {
  Object.assign(model, JSON.parse(JSON.stringify(m)))
}

function delModel(id) {
  savedModels.value = savedModels.value.filter((x) => x.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedModels.value))
}

// ── 运行回测 ──
async function onRun() {
  if (!model.startDate) { showToast('请选择起始日期'); return }
  if (!model.params.periods.length) { showToast('请至少选一个周期'); return }
  running.value = true
  result.value = null
  try {
    result.value = await runBacktest(model, model.startDate, (p) => {
      progress.value = p
    })
    if (result.value.status !== 'empty') {
      await nextTick()
      drawCharts()
    }
  } catch (e) {
    showToast('回测失败：' + (e.message || '未知错误'))
  } finally {
    running.value = false
  }
}

function drawCharts() {
  if (!result.value) return
  const eq = result.value.equityCurve
  if (dailyCanvas.value && eq.length) {
    drawEquityCurve(dailyCanvas.value, eq)
  }
  if (weeklyCanvas.value && result.value.weeklyCurve.length) {
    drawHistogram(weeklyCanvas.value, result.value.weeklyCurve)
  }
  if (monthlyCanvas.value && result.value.monthlyCurve.length) {
    drawHistogram(monthlyCanvas.value, result.value.monthlyCurve)
  }
}

// tab 切换时重绘
watch(chartTab, async () => {
  await nextTick()
  drawCharts()
})

onMounted(() => {
  loadSavedModels()
})
</script>

<style scoped>
.bt-page { padding-bottom: 40px; }
.up { color: #f44336; }
.down { color: #4caf50; }
.flat { color: #9e9e9e; }

.section-card {
  margin: 12px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
}
.card-title {
  font-size: 14px; font-weight: bold; margin-bottom: 10px;
  display: flex; align-items: center;
}
.ml-auto { margin-left: auto; }

.filter-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; font-size: 13px;
}
.filter-label { min-width: 44px; color: var(--text-secondary); }
.chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  padding: 2px 10px; border-radius: 12px; font-size: 12px;
  border: 1px solid rgba(255,255,255,0.15);
  cursor: pointer; user-select: none;
}
.chip.active { background: rgba(33,150,243,0.2); border-color: #2196f3; color: #64b5f6; }
.chip.elem.el-木 { color: #66bb6a; }
.chip.elem.el-火 { color: #ef5350; }
.chip.elem.el-土 { color: #ffa726; }
.chip.elem.el-金 { color: #bcaaa4; }
.chip.elem.el-水 { color: #42a5f5; }

.num-input {
  width: 72px; padding: 2px 6px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px; color: #fff; font-size: 12px;
}
.num-input.small { width: 52px; }
.dash { color: var(--text-secondary); }
.date-input {
  padding: 2px 6px; background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
  color: #fff; font-size: 12px;
}

.param-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  padding: 8px 0;
}
.param-item { display: flex; align-items: center; gap: 6px; }
.param-label { font-size: 12px; color: var(--text-secondary); min-width: 60px; }

.btn-row { display: flex; gap: 10px; margin-top: 10px; }

.saved-model {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; font-size: 12px;
  border-bottom: 1px dashed rgba(255,255,255,0.06);
}
.sm-name { font-weight: bold; min-width: 80px; }
.sm-params { flex: 1; color: var(--text-secondary); }
.sm-del { color: #f44336; }

.prog-text { margin-left: 8px; font-size: 13px; color: var(--text-secondary); }

.stats-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
}
.stat-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
}
.stat-val { font-size: 18px; font-weight: bold; font-family: monospace; }
.stat-lbl { font-size: 11px; color: var(--text-secondary); }

.bt-canvas { width: 100%; height: 180px; }

.trades-list { max-height: 320px; overflow-y: auto; }
.trade-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; font-size: 12px;
  border-bottom: 1px dashed rgba(255,255,255,0.04);
}
.t-name { min-width: 60px; font-weight: bold; }
.t-date { color: var(--text-secondary); font-size: 11px; }
.t-hold { color: var(--text-secondary); }
.t-pnl { font-weight: bold; min-width: 50px; text-align: right; }
.t-reason { color: var(--text-secondary); font-size: 10px; margin-left: auto; }

.empty-result {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  color: var(--text-secondary);
}
</style>
