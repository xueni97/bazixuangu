<template>
  <div class="weekly-page">
    <van-nav-bar title="周方向" left-arrow @click-left="$router.back()" />

    <div v-if="weekly" class="content">
      <div class="card">
        <div class="card-title">本周概况</div>
        <div class="week-summary">
          <div class="summary-row">
            <span class="label">周用神</span>
            <span v-for="e in weekly.weekUseGods" :key="e" class="god-tag" :class="'bg-' + e">{{ e }}</span>
          </div>
          <div class="summary-row">
            <span class="label">周忌神</span>
            <span v-for="e in weekly.weekAvoidGods" :key="e" class="god-tag muted" :class="'bg-' + e">{{ e }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">每日分解</div>
        <div v-for="(d, i) in weekly.dailyBreakdown" :key="i" class="day-row"
          :class="{ best: d.date === weekly.bestDay.date }">
          <div class="day-info">
            <span class="day-date">{{ d.date }}</span>
            <span class="day-weekday">{{ d.weekday }}</span>
          </div>
          <div class="day-pillar">{{ d.pillar }}</div>
          <div class="day-gods">
            <span v-for="e in d.useGods" :key="e" class="mini-tag" :class="'bg-' + e">{{ e }}</span>
            <span v-for="e in d.avoidGods" :key="'a'+e" class="mini-tag muted" :class="'bg-' + e">{{ e }}</span>
          </div>
          <div class="day-strength">{{ d.dayMasterStrength }}</div>
        </div>
      </div>

      <div class="card best-card" v-if="weekly.bestDay">
        <div class="card-title">最佳交易日</div>
        <div class="best-info">
          <van-icon name="certificate" color="#f5a623" size="20" />
          <span>{{ weekly.bestDay.date }} ({{ weekly.bestDay.weekday }})</span>
        </div>
      </div>

      <div class="card" v-if="weeklySectors.length">
        <div class="card-title">推荐板块（按用神）</div>
        <div v-for="item in weeklySectors" :key="item.elem" class="sector-row">
          <span :class="'element-' + item.elem" class="sector-elem">{{ item.elem }}</span>
          <span class="sector-list">{{ item.sectors.join('、') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { YuanhaiDecisionModel } from '../core'

const weekly = ref(null)

const weeklySectors = computed(() => {
  if (!weekly.value) return []
  const sectors = YuanhaiDecisionModel._element_to_sectors(weekly.value.weekUseGods.slice(0, 3))
  return Object.entries(sectors).map(([elem, sectors]) => ({ elem, sectors }))
})

onMounted(() => {
  weekly.value = YuanhaiDecisionModel.weekly_direction(new Date())
})
</script>

<style scoped>
.weekly-page { padding-bottom: 40px; }
.content { padding: 0 12px; }

.card {
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.card-title { font-size: 15px; font-weight: bold; margin-bottom: 12px; }

.week-summary { display: flex; flex-direction: column; gap: 10px; }
.summary-row { display: flex; align-items: center; gap: 8px; }
.summary-row .label { font-size: 12px; color: var(--text-secondary); width: 40px; }

.god-tag { padding: 4px 12px; border-radius: 6px; font-size: 14px; border: 1px solid; }
.god-tag.muted { opacity: 0.4; }

.day-row {
  display: flex;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  gap: 10px;
}
.day-row.best { background: rgba(245,166,35,0.08); border-radius: 8px; padding: 10px; }
.day-info { min-width: 90px; }
.day-date { font-size: 13px; }
.day-weekday { font-size: 11px; color: var(--text-secondary); margin-left: 4px; }
.day-pillar { font-size: 16px; font-weight: bold; min-width: 40px; }
.day-gods { flex: 1; display: flex; gap: 4px; flex-wrap: wrap; }
.day-strength { font-size: 11px; color: var(--text-secondary); }

.mini-tag { padding: 2px 6px; border-radius: 4px; font-size: 11px; border: 1px solid; }
.mini-tag.muted { opacity: 0.3; }

.best-card { border-color: rgba(245,166,35,0.3); }
.best-info { display: flex; align-items: center; gap: 8px; font-size: 16px; }

.sector-row { margin-bottom: 6px; display: flex; gap: 8px; }
.sector-elem { font-weight: bold; min-width: 20px; }
.sector-list { font-size: 13px; color: var(--text-secondary); }
</style>
