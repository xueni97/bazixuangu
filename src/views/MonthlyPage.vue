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

      <div class="card evil-card" v-if="monthEvilDays.length">
        <div class="card-title">⚠ 本月避凶日（择日学）</div>
        <div class="evil-tip">本月共 {{ monthEvilDays.length }} 个凶日，命理信号即便看多也宜观望，不开新仓：</div>
        <div v-for="d in monthEvilDays" :key="d.date" class="evil-row">
          <span class="evil-date">{{ d.date }}</span>
          <span class="evil-reasons">{{ d.reasons.join('、') }}</span>
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
import { ref, onMounted, computed } from 'vue'
import { YuanhaiDecisionModel } from '../core'
import { getAlmanac } from '../lib/metaphysics/almanac.js'

const monthly = ref(null)

// 扫描本月所有日，挑出凶日（四离/四绝/岁破/月破/凶值星）
const monthEvilDays = computed(() => {
  if (!monthly.value) return []
  const out = []
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d, 12, 0, 0, 0)
    const alm = getAlmanac(dt)
    if (alm.inauspicious) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      out.push({ date: dateStr, reasons: alm.reasons, officer: alm.officer })
    }
  }
  return out
})

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

/* 本月避凶日卡 */
.evil-card {
  border-color: rgba(156,39,176,0.4);
  background: linear-gradient(135deg, rgba(156,39,176,0.10), rgba(244,67,54,0.04));
}
.evil-tip { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.evil-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px dashed rgba(255,255,255,0.06);
  font-size: 13px;
}
.evil-row:last-child { border-bottom: none; }
.evil-date { font-family: monospace; color: #ce93d8; font-weight: bold; min-width: 100px; }
.evil-reasons { color: #f8bbd0; }

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
