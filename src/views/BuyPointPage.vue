<template>
  <div class="buy-point-page">
    <van-nav-bar title="买点信号" left-arrow @click-left="$router.back()" />

    <div class="content">
      <div class="card" v-for="(bp, i) in buyPoints" :key="i"
        :class="actionClass(bp.action)">
        <div class="bp-header">
          <div class="bp-date">
            <span class="date-text">{{ bp.date.slice(5) }}</span>
            <span class="weekday">{{ bp.weekday }}</span>
          </div>
          <div class="bp-action" :class="actionClass(bp.action)">
            {{ bp.action }}
          </div>
        </div>
        <div class="bp-score">
          信号分: <strong :class="bp.signalScore >= 0 ? 'positive' : 'negative'">
            {{ bp.signalScore >= 0 ? '+' : '' }}{{ bp.signalScore }}
          </strong>
        </div>
        <div class="bp-signals" v-if="bp.signals.length">
          <div v-for="(s, j) in bp.signals" :key="j" class="signal-item">
            <span class="signal-dot" :class="signalType(s)"></span>
            <span>{{ s }}</span>
          </div>
        </div>
        <div v-else class="empty">无明显信号</div>

        <div class="bp-gods">
          <span v-for="(v, k) in bp.tenGodDistribution" :key="k" class="tg-mini">
            {{ k }}:{{ v }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
import { YuanhaiDecisionModel } from '../core'

const buyPoints = ref([])

function actionClass(action) {
  if (action.includes('买入')) return 'act-buy'
  if (action.includes('观望')) return 'act-hold'
  if (action.includes('减仓') || action.includes('卖出')) return 'act-sell'
  return 'act-try'
}

function signalType(s) {
  if (s.includes('买入') || s.includes('有利') || s.includes('扶持') || s.includes('可持')) return 'dot-positive'
  if (s.includes('谨慎') || s.includes('不胜') || s.includes('破财') || s.includes('泄气')) return 'dot-negative'
  return 'dot-neutral'
}

onMounted(() => {
  const now = new Date()
  const points = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const bp = YuanhaiDecisionModel.buy_point_signal(d)
    bp.weekday = dayjs(d).format('ddd')
    points.push(bp)
  }
  buyPoints.value = points
})
</script>

<style scoped>
.buy-point-page { padding-bottom: 40px; }
.content { padding: 0 12px; }

.card {
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-left: 4px solid transparent;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 10px;
}
.act-buy { border-left-color: var(--wood); }
.act-hold { border-left-color: var(--water); }
.act-sell { border-left-color: var(--fire); }
.act-try { border-left-color: var(--earth); }

.bp-header { display: flex; justify-content: space-between; align-items: center; }
.bp-date { display: flex; gap: 6px; align-items: baseline; }
.date-text { font-size: 16px; font-weight: bold; }
.weekday { font-size: 12px; color: var(--text-secondary); }
.bp-action { font-size: 14px; font-weight: bold; padding: 2px 10px; border-radius: 4px; }
.act-buy .bp-action { color: #4caf50; background: rgba(76,175,80,0.15); }
.act-hold .bp-action { color: #2196f3; background: rgba(33,150,243,0.15); }
.act-sell .bp-action { color: #f44336; background: rgba(244,67,54,0.15); }
.act-try .bp-action { color: #ff9800; background: rgba(255,152,0,0.15); }

.bp-score { font-size: 13px; margin: 8px 0; }
.positive { color: #4caf50; }
.negative { color: #f44336; }

.bp-signals { margin-bottom: 8px; }
.signal-item { display: flex; gap: 8px; font-size: 13px; padding: 3px 0; }
.signal-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.dot-positive { background: #4caf50; }
.dot-negative { background: #f44336; }
.dot-neutral { background: #2196f3; }
.empty { font-size: 13px; color: var(--text-secondary); padding: 4px 0; }

.bp-gods { display: flex; flex-wrap: wrap; gap: 4px; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 8px; }
.tg-mini { font-size: 10px; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 3px; }
</style>
