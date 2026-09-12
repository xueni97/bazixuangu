<template>
  <div class="monthly-page">
    <van-nav-bar title="月方向" left-arrow @click-left="$router.back()" />

    <div v-if="monthly" class="content">
      <div class="card">
        <div class="card-title">{{ monthly.yearMonth }} 月度概况</div>
        <div class="month-pillar-info">
          <div class="mp-item">
            <span class="mp-label">月柱</span>
            <span class="mp-value">{{ monthly.monthPillar }}</span>
          </div>
          <div class="mp-item">
            <span class="mp-label">月干</span>
            <span :class="'element-' + monthly.monthStemElement">{{ monthly.monthStemElement }}</span>
          </div>
          <div class="mp-item">
            <span class="mp-label">月支</span>
            <span :class="'element-' + monthly.monthBranchElement">{{ monthly.monthBranchElement }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">月度用神</div>
        <div class="gods-section">
          <div class="gods-row">
            <span class="row-label">月用神</span>
            <span v-for="e in monthly.monthUseGods" :key="e" class="god-tag" :class="'bg-' + e">{{ e }}</span>
          </div>
          <div class="gods-row">
            <span class="row-label">月忌神</span>
            <span v-for="e in monthly.monthAvoidGods" :key="e" class="god-tag muted" :class="'bg-' + e">{{ e }}</span>
          </div>
          <div class="gods-row" v-if="monthly.toneGod">
            <span class="row-label">调候用神</span>
            <span class="god-tag" :class="'bg-' + monthly.toneGod">{{ monthly.toneGod }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">每周分解</div>
        <div v-for="(w, i) in monthly.weeklyBreakdown" :key="i" class="week-row">
          <span class="week-start">{{ w.weekStart }}</span>
          <div class="week-tags">
            <span v-for="e in w.useGods" :key="e" class="mini-tag" :class="'bg-' + e">{{ e }}</span>
            <span v-for="e in w.avoidGods" :key="'a'+e" class="mini-tag muted" :class="'bg-' + e">{{ e }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">推荐板块</div>
        <div v-for="(sectors, e) in monthly.recommendedSectors" :key="e" class="sector-row">
          <span :class="'element-' + e" class="sector-elem">{{ e }}</span>
          <span class="sector-list">{{ sectors.join('、') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { YuanhaiDecisionModel } from '../core'

const monthly = ref(null)

onMounted(() => {
  monthly.value = YuanhaiDecisionModel.monthly_direction(new Date())
})
</script>

<style scoped>
.monthly-page { padding-bottom: 40px; }
.content { padding: 0 12px; }

.card {
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.card-title { font-size: 15px; font-weight: bold; margin-bottom: 12px; }

.month-pillar-info { display: flex; gap: 20px; }
.mp-item { display: flex; flex-direction: column; }
.mp-label { font-size: 11px; color: var(--text-secondary); }
.mp-value { font-size: 20px; font-weight: bold; }

.gods-section { display: flex; flex-direction: column; gap: 10px; }
.gods-row { display: flex; align-items: center; gap: 8px; }
.row-label { font-size: 12px; color: var(--text-secondary); width: 70px; }

.god-tag { padding: 4px 12px; border-radius: 6px; font-size: 14px; border: 1px solid; }
.god-tag.muted { opacity: 0.4; }

.week-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.week-start { font-size: 13px; min-width: 100px; }
.week-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.mini-tag { padding: 2px 6px; border-radius: 4px; font-size: 11px; border: 1px solid; }
.mini-tag.muted { opacity: 0.3; }

.sector-row { margin-bottom: 6px; display: flex; gap: 8px; }
.sector-elem { font-weight: bold; min-width: 20px; }
.sector-list { font-size: 13px; color: var(--text-secondary); }
</style>
