<template>
  <div class="daily-page">
    <van-nav-bar title="日方向" left-arrow @click-left="$router.back()" />

    <van-cell-group inset class="date-picker-group">
      <van-cell title="选择日期">
        <template #right-icon>
          <van-date-picker
            v-model="dateVal"
            :min-date="minDate"
            :max-date="maxDate"
            @confirm="onDateConfirm"
          />
        </template>
      </van-cell>
    </van-cell-group>

    <div v-if="daily" class="content">
      <div class="pillar-card">
        <div class="card-title">当日四柱</div>
        <div class="pillars-display">
          <div v-for="(p, i) in daily.pillarList" :key="i" class="pillar-block">
            <div class="p-label">{{ p.label }}</div>
            <div :class="'element-' + p.stemElem">{{ p.stem }}</div>
            <div :class="'element-' + p.branchElem">{{ p.branch }}</div>
          </div>
        </div>
        <div class="dm-info">
          <span>日主 {{ daily.dayMaster }} ({{ daily.dayMasterElement }})</span>
          <span>旺衰: <strong>{{ daily.dayMasterStrength }}</strong></span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">五行旺衰</div>
        <div class="strength-grid">
          <div v-for="(s, e) in daily.elementsStrength" :key="e" class="strength-item">
            <span :class="'element-' + e" class="elem-name">{{ e }}</span>
            <span class="strength-tag" :class="'str-' + s">{{ s }}</span>
            <div class="score-bar">
              <div class="score-fill" :class="'element-bg-' + e" :style="{ width: strengthPct(s) + '%' }"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">用神忌神</div>
        <div class="gods-row">
          <div class="use-gods">
            <div class="row-label">推荐五行</div>
            <div class="god-tags">
              <span v-for="e in daily.recommendedElements" :key="e"
                class="god-tag" :class="'bg-' + e">
                {{ e }}
              </span>
            </div>
          </div>
          <div class="avoid-gods">
            <div class="row-label">回避五行</div>
            <div class="god-tags">
              <span v-for="e in daily.avoidElements" :key="e"
                class="god-tag muted" :class="'bg-' + e">
                {{ e }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="daily.toneGod" class="tone-god">
          调候用神: <strong :class="'element-' + daily.toneGod">{{ daily.toneGod }}</strong>
        </div>
      </div>

      <div class="card">
        <div class="card-title">十神分布</div>
        <div class="ten-gods">
          <div v-for="(god, name) in daily.tenGods" :key="name" class="tg-item">
            <span class="tg-name">{{ name }}柱</span>
            <span class="tg-god">{{ god }}</span>
          </div>
        </div>
      </div>

      <div class="card" v-if="daily.recommendedElements.length">
        <div class="card-title">推荐板块</div>
        <div v-for="(sectors, e) in dailySectors" :key="e" class="sector-row">
          <span :class="'element-' + e" class="sector-elem">{{ e }}</span>
          <span class="sector-list">{{ sectors.join('、') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import dayjs from 'dayjs'
import { BaziEngine, YuanhaiDecisionModel, STEMS, BRANCHES } from '../core'

const STEMS_ELEMENTS = {}
STEMS.forEach((s, i) => { STEMS_ELEMENTS[s] = ['木','木','火','火','土','土','金','金','水','水'][i] })
const BRANCHES_ELEMENTS = {}
BRANCHES.forEach((b, i) => { BRANCHES_ELEMENTS[b] = ['水','土','木','木','土','火','火','土','金','金','土','水'][i] })
const ELEM_MAP = { '木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water' }
const STRENGTH_PCT = { '旺': 100, '相': 75, '休': 50, '囚': 25, '死': 10 }

const daily = ref(null)
const dateVal = ref([])
const minDate = new Date(2020, 0, 1)
const maxDate = new Date(2026, 11, 31)

function loadDaily(dt) {
  const d = YuanhaiDecisionModel.daily_direction(dt)
  const pillars = BaziEngine.from_datetime(dt)
  const labels = ['年','月','日','时']
  const ps = [pillars.year, pillars.month, pillars.day, pillars.hour]
  d.pillarList = ps.map((p, i) => ({
    label: labels[i], stem: p.stem, branch: p.branch,
    stemElem: ELEM_MAP[STEMS_ELEMENTS[p.stem]],
    branchElem: ELEM_MAP[BRANCHES_ELEMENTS[p.branch]],
  }))
  daily.value = d
}

const dailySectors = computed(() => {
  if (!daily.value) return {}
  return YuanhaiDecisionModel._element_to_sectors(daily.value.recommendedElements.slice(0, 3))
})

function strengthPct(s) { return STRENGTH_PCT[s] || 50 }

function onDateConfirm({ selectedValues }) {
  const [y, m, d] = selectedValues
  loadDaily(new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12))
}

onMounted(() => {
  const now = new Date()
  dateVal.value = [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')]
  loadDaily(now)
})
</script>

<style scoped>
.daily-page { padding-bottom: 40px; }
.date-picker-group { margin: 12px; }

.content { padding: 0 12px; }

.pillar-card, .card {
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.card-title { font-size: 15px; font-weight: bold; margin-bottom: 12px; }

.pillars-display { display: flex; justify-content: space-around; margin-bottom: 12px; }
.pillar-block { text-align: center; }
.p-label { font-size: 11px; color: var(--text-secondary); }
.pillar-block div:nth-child(2),
.pillar-block div:nth-child(3) { font-size: 20px; font-weight: bold; }

.dm-info { display: flex; gap: 16px; justify-content: center; font-size: 13px; }

.strength-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.strength-item { text-align: center; }
.elem-name { font-size: 16px; font-weight: bold; display: block; }
.strength-tag { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.1); }
.str-旺 { color: #4caf50; }
.str-相 { color: #8bc34a; }
.str-休 { color: #ffc107; }
.str-囚 { color: #ff9800; }
.str-死 { color: #f44336; }
.score-bar { margin-top: 4px; }
.score-fill { height: 4px; border-radius: 2px; }

.element-bg-木 { background: var(--wood); }
.element-bg-火 { background: var(--fire); }
.element-bg-土 { background: var(--earth); }
.element-bg-金 { background: var(--metal); }
.element-bg-水 { background: var(--water); }

.gods-row { display: flex; gap: 16px; }
.use-gods, .avoid-gods { flex: 1; }
.row-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.god-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.god-tag { padding: 4px 12px; border-radius: 6px; font-size: 14px; border: 1px solid; }
.god-tag.muted { opacity: 0.4; }

.tone-god { margin-top: 10px; font-size: 13px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }

.ten-gods { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.tg-item { text-align: center; }
.tg-name { font-size: 11px; color: var(--text-secondary); display: block; }
.tg-god { font-size: 14px; font-weight: bold; }

.sector-row { margin-bottom: 6px; display: flex; gap: 8px; }
.sector-elem { font-weight: bold; min-width: 20px; }
.sector-list { font-size: 13px; color: var(--text-secondary); }
</style>
