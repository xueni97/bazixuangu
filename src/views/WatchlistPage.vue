<template>
  <div class="wl-page">
    <van-nav-bar title="自选观察" left-arrow @click-left="$router.back()">
      <template #right>
        <van-icon name="replay" size="18" @click="load(true)" />
      </template>
    </van-nav-bar>

    <!-- 战绩总览 -->
    <div v-if="records.length" class="overview-card">
      <div class="ov-top">
        <div class="ov-ring" :style="ringStyle">
          <div class="ov-ring-inner">
            <span class="ov-rate">{{ stats.winrate == null ? '—' : stats.winrate + '%' }}</span>
            <span class="ov-rate-lbl">总胜率</span>
          </div>
        </div>
        <div class="ov-meta">
          <div class="ov-line">累计 {{ stats.total }} 只 · 已开 {{ stats.settled }} · 待开奖 {{ stats.pending }}</div>
          <div class="ov-line">
            均涨跌 <b :class="pnlClass(stats.avgPnl)">{{ fmt(stats.avgPnl) }}%</b>
            <span class="ov-streak" v-if="stats.streak.dir">
              {{ stats.streak.dir === 'red' ? '🔥' : '🧊' }}
              {{ stats.streak.dir === 'red' ? stats.streak.n + '连红' : stats.streak.n + '连黑' }}
            </span>
          </div>
          <div class="ov-line ov-mood" v-if="mood">{{ mood }}</div>
        </div>
      </div>
      <div class="ov-last5" v-if="stats.last5.length">
        <div v-for="d in stats.last5" :key="d.date" class="l5-col">
          <div class="l5-bar-wrap">
            <div class="l5-bar" :class="rateClass(d.winrate)" :style="{ height: barH(d.winrate) }"></div>
          </div>
          <span class="l5-label">{{ d.date.slice(5) }}</span>
        </div>
      </div>
    </div>

    <!-- 一键组 vs 手动组 -->
    <div v-if="records.length" class="compare-card">
      <div class="card-title">
        一键组 vs 手动组
        <van-button
          v-if="!isPostMarket"
          size="mini" plain type="warning" class="preview-btn"
          :loading="previewing" @click="doPreview"
        >
          实时预览浮动
        </van-button>
        <van-button
          v-if="!isPostMarket"
          size="mini" plain type="primary" class="preview-btn"
          :loading="refreshing" @click="doRefreshQuotes"
        >
          刷新实时
        </van-button>
      </div>
      <div class="cmp-row">
        <div v-for="s in srcStats" :key="s.source" class="cmp-item">
          <span class="cmp-name" :class="s.source === 'auto' ? 'tag-auto' : 'tag-manual'">
            {{ s.source === 'auto' ? '一键勾选' : '手动勾选' }}
          </span>
          <span class="cmp-rate" :class="rateClass(s.winrate)">
            {{ s.winrate == null ? '待开奖' : s.winrate + '%' }}
          </span>
          <span class="cmp-sub">{{ s.settled }}/{{ s.count }} 只 · 均 {{ fmt(s.avgPnl) }}%</span>
        </div>
      </div>
    </div>

    <!-- 入池条件战绩 -->
    <div v-if="condStats.length" class="compare-card">
      <div class="card-title">入池条件战绩</div>
      <div v-for="c in condStats" :key="c.label" class="cond-row">
        <span class="cond-label">
          {{ c.label }}
          <em v-if="c.smallSample" class="small-sample">样本少</em>
        </span>
        <span class="cond-rate" :class="rateClass(c.winrate)">{{ c.winrate == null ? '—' : c.winrate + '%' }}</span>
        <span class="cond-sub">{{ c.win }}胜{{ c.lose }}负<template v-if="c.flat">{{ c.flat }}平</template> · 均{{ fmt(c.avgPnl) }}%</span>
      </div>
    </div>

    <!-- 按信号日分组 -->
    <div v-for="g in groups" :key="g.date" class="day-group">
      <div class="day-head" @click="toggleGroup(g.date)">
        <van-icon :name="openGroups.has(g.date) ? 'arrow-up' : 'arrow-down'" class="day-arrow" />
        <span class="day-date">{{ g.date }}</span>
        <span class="day-count">{{ g.items.length }}只</span>
        <template v-if="g.settledN">
          <span class="day-rate" :class="rateClass(g.winrate)">
            {{ g.winrate == null ? '—' : g.winrate + '%' }}
          </span>
          <span class="day-sub">
            胜{{ g.win }}负{{ g.lose }}<template v-if="g.flat">平{{ g.flat }}</template> · 均{{ fmt(g.avgPnl) }}%
          </span>
        </template>
        <span v-else-if="g.pending" class="day-sub pending-txt">等明日收盘开奖</span>
      </div>

      <div v-show="openGroups.has(g.date)" class="day-body">
        <van-swipe-cell v-for="r in g.items" :key="r.id">
          <div class="rec-card" @click="toggleRec(r.id)">
            <div class="rec-main">
              <div class="rec-id">
                <span class="rec-name">{{ r.name }}</span>
                <span class="rec-code">{{ r.symbol }}</span>
                <span v-if="r.stemLabel" class="rec-tag stem">{{ r.stemLabel }}</span>
                <span v-if="r.godLabel" class="rec-tag god">{{ r.godLabel }}</span>
                <span class="rec-tag" :class="r.source === 'auto' ? 'tag-auto' : 'tag-manual'">
                  {{ r.source === 'auto' ? '一键' : '手动' }}
                </span>
              </div>
              <div class="rec-result">
                <template v-if="r.status === 'settled'">
                  <span class="rec-talk" :class="pnlClass(r.pnlPct)">{{ talkLabel(r) }}</span>
                  <span class="rec-pnl" :class="pnlClass(r.pnlPct)">{{ fmt(r.pnlPct) }}%</span>
                </template>
                <template v-else-if="previewMap.get(r.id)">
                  <span class="rec-talk preview" :class="pnlClass(previewMap.get(r.id).unrealizedPnl)">
                    浮{{ fmt(previewMap.get(r.id).unrealizedPnl) }}%
                  </span>
                  <span class="rec-pnl preview" :class="pnlClass(previewMap.get(r.id).unrealizedPnl)">
                    {{ Number(previewMap.get(r.id).currentPrice).toFixed(2) }}
                  </span>
                </template>
                <span v-else class="rec-talk pending">等开奖</span>
              </div>
            </div>
            <div v-if="r.status === 'settled'" class="rec-bar">
              <div class="rec-bar-zero"></div>
              <div
                class="rec-bar-fill"
                :class="[pnlClass(r.pnlPct), r.pnlPct > 0 ? 'from-right' : 'from-left']"
                :style="{ width: barWidth(r.pnlPct) }"
              ></div>
            </div>
            <div class="rec-sub">
              <span>入池 {{ r.entryPrice != null ? Number(r.entryPrice).toFixed(2) : '—' }}</span>
              <span v-if="r.exitPrice != null">→ 次日收 {{ Number(r.exitPrice).toFixed(2) }}</span>
              <span v-if="r.nextTradeDate" class="rec-date">{{ r.nextTradeDate }}</span>
              <span class="rec-score">综合 {{ r.score > 0 ? '+' : '' }}{{ r.score ?? '—' }}</span>
            </div>
            <div v-if="openRecs.has(r.id)" class="rec-detail" @click.stop>
              <div v-if="r.pillars" class="rd-row"><span class="rd-k">信号日柱</span>{{ r.pillars }}</div>
              <div v-for="p in (r.periodPillars || [])" :key="p.key" class="rd-row">
                <span class="rd-k">{{ p.label }}柱 · {{ p.date }}</span>{{ p.pillars }}
              </div>
              <div class="rd-row"><span class="rd-k">入池条件</span>{{ r.filtersLabel }}</div>
              <div class="rd-row"><span class="rd-k">入池理由</span>{{ r.reason || '—' }}</div>
              <van-button
                size="mini" plain type="primary" class="reenter-btn"
                :loading="reEntering === r.id" @click="onReEnter(r)"
              >
                再次入池（按今日信号）
              </van-button>
            </div>
          </div>
          <template #right>
            <van-button square type="danger" text="删除" class="del-btn" @click="onDelete(r)" />
          </template>
        </van-swipe-cell>
      </div>
    </div>

    <div v-if="loading" class="state">
      <van-loading type="spinner" />
      <span>结算中 {{ progressText }}</span>
    </div>
    <div v-else-if="!records.length" class="state empty">
      <van-icon name="star-o" size="48" color="#555" />
      <p class="empty-title">自选观察池还是空的</p>
      <p class="empty-hint">去「股票扫描」勾选看好的票，T 日收盘入场、T+1 收盘自动判胜负</p>
      <van-button type="primary" size="small" @click="$router.push('/scan')">去扫描</van-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { showToast, showConfirmDialog } from 'vant'
import {
  listRecords, settleWatchlist, removeRecord, groupRecords,
  overallStats, sourceStats, conditionStats, addWatchlist,
  isAfterMarketClose, previewSettlement, getSignalDate,
} from '../lib/watchlist.js'
import { searchStocks } from '../api'
import { fetchQuotes } from '../lib/market/quote.js'

const records = ref([])
const loading = ref(true)
const progress = ref({ done: 0, total: 0 })
const openGroups = ref(new Set())
const openRecs = ref(new Set())
const reEntering = ref(null)
const previews = ref([])
const previewing = ref(false)
const refreshing = ref(false)
const isPostMarket = ref(true)

const groups = computed(() => groupRecords(records.value))
const stats = computed(() => overallStats(records.value))
const srcStats = computed(() => sourceStats(records.value))
const condStats = computed(() => conditionStats(records.value))
const progressText = computed(() =>
  (progress.value.total ? `${progress.value.done}/${progress.value.total}` : ''))

// 预览记录映射：id → preview 对象
const previewMap = computed(() => {
  const m = new Map()
  for (const p of previews.value) m.set(p.id, p)
  return m
})

// 总胜率环：≥60%红（赢面大）、<40%绿、中间灰
const ringStyle = computed(() => {
  const w = stats.value.winrate
  let color = '#9e9e9e'
  if (w != null) {
    if (w >= 60) color = '#f44336'
    else if (w < 40) color = '#4caf50'
  }
  const deg = w == null ? 0 : w * 3.6
  return { background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)` }
})

// 一句人话总结
const mood = computed(() => {
  const s = stats.value
  if (!s.settled) return ''
  if (s.streak.dir === 'red') return '最近手气正旺，别上头，纪律第一'
  if (s.streak.dir === 'black') return '连黑中，多看少动等风来'
  if (s.avgPnl > 0) return '整体有赚头，继续观察'
  if (s.avgPnl < 0) return '整体在回撤，收收手'
  return '不赚不亏，白忙活'
})

function fmt(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v
}
// 红涨绿跌
function pnlClass(v) {
  if (v == null) return ''
  if (v > 0.01) return 'up'
  if (v < -0.01) return 'down'
  return 'flat'
}
function rateClass(w) {
  if (w == null) return ''
  if (w >= 60) return 'up'
  if (w < 40) return 'down'
  return 'flat'
}
// 口语化结果：≥+5%吃肉 / 0~+5%见红 / 平白玩 / -5~0浮亏 / ≤-5%吃面
function talkLabel(r) {
  if (r.status !== 'settled') return '等开奖'
  const v = r.pnlPct || 0
  if (v >= 5) return '吃肉'
  if (v > 0.01) return '见红'
  if (v <= -5) return '吃面'
  if (v < -0.01) return '浮亏'
  return '白玩'
}
// 横向涨跌条：10% 铺满
function barWidth(v) {
  return Math.min(50, Math.abs(v || 0) * 5) + '%'
}
function barH(w) {
  if (w == null) return '8%'
  return Math.max(10, w) + '%'
}

function toggleGroup(date) {
  const s = new Set(openGroups.value)
  if (s.has(date)) s.delete(date)
  else s.add(date)
  openGroups.value = s
}
function toggleRec(id) {
  const s = new Set(openRecs.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  openRecs.value = s
}

async function load(doSettle) {
  loading.value = true
  progress.value = { done: 0, total: 0 }
  try {
    if (doSettle) {
      await settleWatchlist((done, total) => { progress.value = { done, total } })
    }
    records.value = await listRecords()
    if (!openGroups.value.size) {
      openGroups.value = new Set(groups.value.map((g) => g.date))
    }
  } catch (e) {
    showToast('结算失败：' + (e.message || '本地数据异常'))
  } finally {
    loading.value = false
  }
}

async function doPreview() {
  previewing.value = true
  try {
    previews.value = await previewSettlement((done, total) => {
      progress.value = { done, total }
    })
  } catch (e) {
    showToast('预览失败：' + (e.message || '本地数据异常'))
  } finally {
    previewing.value = false
  }
}

// 按当前 pending 标的批量拉网络实时报价，重算浮动盈亏（不写库）
async function doRefreshQuotes() {
  refreshing.value = true
  try {
    const pending = records.value.filter(
      (r) => r.status !== 'settled' && r.entryPrice != null)
    if (!pending.length) {
      showToast('没有待开奖的持仓')
      return
    }
    const quotes = await fetchQuotes(pending.map((r) => r.symbol))
    const previewTime = Date.now()
    const next = []
    for (const r of pending) {
      const q = quotes.get(r.symbol)
      if (!q || !(r.entryPrice > 0)) continue
      const unrealizedPnl = Math.round(
        ((q.price - r.entryPrice) / r.entryPrice) * 10000) / 100
      let unrealizedResult = 'flat'
      if (unrealizedPnl > 0.01) unrealizedResult = 'win'
      else if (unrealizedPnl < -0.01) unrealizedResult = 'lose'
      next.push({
        ...r, currentPrice: q.price, priceSource: 'realtime',
        unrealizedPnl, unrealizedResult, previewTime,
      })
    }
    if (!next.length) {
      showToast('未取到实时行情（网络异常或停牌）')
      return
    }
    previews.value = next
    showToast(`实时行情已刷新（${next.length}/${pending.length} 只）`)
  } catch (e) {
    showToast('刷新失败：' + (e.message || '网络异常'))
  } finally {
    refreshing.value = false
  }
}

// 挂载逻辑：盘后自动结算，盘中仅列表+预览浮动
onMounted(async () => {
  const maTradeDate = await getSignalDate()
  isPostMarket.value = isAfterMarketClose(maTradeDate)
  if (isPostMarket.value) {
    await load(true) // 盘后自动结算
  } else {
    await load(false) // 盘中仅列表
    await doPreview() // 自动预览一次浮动
  }
})

async function onDelete(r) {
  try {
    await showConfirmDialog({
      title: '删除记录',
      message: `从自选池删除「${r.name}」${r.signalDate} 这条记录？`,
    })
  } catch {
    return // 取消
  }
  await removeRecord(r.id)
  records.value = records.value.filter((x) => x.id !== r.id)
  showToast('已删除')
}

async function onReEnter(r) {
  reEntering.value = r.id
  try {
    const rows = await searchStocks(r.symbol, ['monthly', 'weekly', 'daily'])
    const hit = rows.find((x) => x.symbol === r.symbol)
    if (!hit) {
      showToast('今日快照未找到该票（可能停牌/退市）')
      return
    }
    const res = await addWatchlist([hit], {
      source: 'manual',
      periods: r.periods || ['monthly', 'weekly', 'daily'],
      filtersLabel: `再次入池·${r.filtersLabel || '自选'}`,
      filters: r.filters || {},
      pillars: '',
      periodPillars: [],
    })
    if (res.added) {
      showToast(`已按今日信号重新入池（${res.signalDate}）`)
      records.value = await listRecords()
      openGroups.value = new Set([res.signalDate, ...openGroups.value])
    } else {
      showToast('该票今日已在池中')
    }
  } catch (e) {
    showToast('再次入池失败：' + (e.message || '本地数据异常'))
  } finally {
    reEntering.value = null
  }
}

</script>

<style scoped>
.wl-page { padding-bottom: 40px; }
.up { color: #f44336; }
.down { color: #4caf50; }
.flat { color: #9e9e9e; }

.card-title { font-size: 14px; font-weight: bold; margin-bottom: 10px; }

/* ── 总览 ── */
.overview-card {
  margin: 12px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
}
.ov-top { display: flex; gap: 16px; align-items: center; }
.ov-ring {
  width: 84px; height: 84px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.ov-ring-inner {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--bg-card, #1a1a2e);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.ov-rate { font-size: 18px; font-weight: bold; }
.ov-rate-lbl { font-size: 11px; color: var(--text-secondary); }
.ov-meta { flex: 1; min-width: 0; }
.ov-line { font-size: 13px; color: var(--text-secondary); line-height: 1.9; }
.ov-line b { font-size: 15px; }
.ov-streak { margin-left: 10px; font-size: 13px; }
.ov-mood { font-size: 12px; opacity: 0.85; }

.ov-last5 {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex; gap: 6px; align-items: flex-end; height: 56px;
}
.l5-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.l5-bar-wrap {
  height: 34px; width: 100%;
  display: flex; align-items: flex-end; justify-content: center;
}
.l5-bar { width: 70%; max-width: 24px; border-radius: 3px 3px 0 0; min-height: 3px; }
.l5-bar.up { background: rgba(244,67,54,0.75); }
.l5-bar.down { background: rgba(76,175,80,0.75); }
.l5-bar.flat { background: #777; }
.l5-label { font-size: 10px; color: var(--text-secondary); }

/* ── 对比卡 ── */
.compare-card {
  margin: 0 12px 12px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
}
.cmp-row { display: flex; gap: 12px; }
.cmp-item {
  flex: 1; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
}
.cmp-name { font-size: 12px; padding: 1px 8px; border-radius: 4px; align-self: flex-start; }
.cmp-rate { font-size: 20px; font-weight: bold; }
.cmp-sub { font-size: 11px; color: var(--text-secondary); }

.tag-auto { color: #f5a623; background: rgba(245,166,35,0.12); border: 1px solid rgba(245,166,35,0.4); }
.tag-manual { color: #4fc3f7; background: rgba(79,195,247,0.1); border: 1px solid rgba(79,195,247,0.4); }

.cond-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; font-size: 12px;
  border-bottom: 1px dashed rgba(255,255,255,0.06);
}
.cond-row:last-child { border-bottom: none; }
.cond-label { flex: 1; min-width: 0; word-break: break-all; }
.small-sample {
  font-style: normal; font-size: 10px; margin-left: 6px;
  color: #f5a623; border: 1px solid rgba(245,166,35,0.4);
  border-radius: 3px; padding: 0 4px;
}
.cond-rate { font-weight: bold; min-width: 42px; text-align: right; }
.cond-sub { color: var(--text-secondary); font-size: 11px; min-width: 96px; text-align: right; }

/* ── 分组 ── */
.day-group { margin: 0 12px 10px; }
.day-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px 10px 0 0;
  font-size: 13px;
}
.day-arrow { color: var(--text-secondary); }
.day-date { font-weight: bold; }
.day-count { color: var(--text-secondary); font-size: 12px; }
.day-rate { font-weight: bold; }
.day-sub { margin-left: auto; color: var(--text-secondary); font-size: 11px; }
.pending-txt { color: #f5a623; }
.day-body { border: 1px solid rgba(255,255,255,0.06); border-top: none; border-radius: 0 0 10px 10px; overflow: hidden; }

.rec-card {
  padding: 10px 12px;
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.rec-card:last-child { border-bottom: none; }
.rec-main { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.rec-id { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; flex-wrap: wrap; }
.rec-name { font-size: 14px; font-weight: bold; }
.rec-code { font-size: 11px; color: var(--text-secondary); font-family: monospace; }
.rec-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; }
.rec-tag.stem { color: #ce93d8; border: 1px solid rgba(206,147,216,0.4); }
.rec-tag.god { color: #d8b56a; border: 1px solid rgba(216,181,106,0.4); }
.rec-result { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.rec-talk {
  font-size: 12px; font-weight: bold; padding: 2px 10px; border-radius: 10px;
}
.rec-talk.up { background: rgba(244,67,54,0.15); }
.rec-talk.down { background: rgba(76,175,80,0.15); }
.rec-talk.flat { background: rgba(158,158,158,0.15); }
.rec-talk.pending { background: rgba(245,166,35,0.12); color: #f5a623; }
.rec-talk.preview { background: rgba(245,166,35,0.08); color: #f5a623; opacity: 0.85; }
.rec-pnl.preview { opacity: 0.75; font-size: 13px; }
.preview-btn { float: right; }

/* 以中线为原点的涨跌横条 */
.rec-bar { position: relative; height: 5px; margin: 8px 0 4px; background: rgba(255,255,255,0.06); border-radius: 3px; }
.rec-bar-zero {
  position: absolute; left: 50%; top: -1px; bottom: -1px; width: 1px;
  background: rgba(255,255,255,0.25);
}
.rec-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.rec-bar-fill.from-right { right: 50%; }
.rec-bar-fill.from-left { left: 50%; }
.rec-bar-fill.up { background: #f44336; }
.rec-bar-fill.down { background: #4caf50; }

.rec-sub {
  display: flex; gap: 10px; flex-wrap: wrap;
  font-size: 11px; color: var(--text-secondary);
}
.rec-score { margin-left: auto; }

.rec-detail {
  margin-top: 8px; padding: 8px 10px;
  background: rgba(255,255,255,0.04); border-radius: 8px;
}
.rd-row { font-size: 12px; line-height: 1.8; color: var(--text-secondary); word-break: break-all; }
.rd-k {
  display: inline-block; min-width: 84px; color: rgba(255,255,255,0.55);
}
.reenter-btn { margin-top: 8px; }

.del-btn { height: 100%; }

/* ── 状态 ── */
.state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 60px 20px; color: var(--text-secondary); font-size: 13px;
}
.empty-title { font-size: 15px; color: #ccc; margin: 8px 0 0; }
.empty-hint { font-size: 12px; text-align: center; max-width: 260px; line-height: 1.6; }
</style>
