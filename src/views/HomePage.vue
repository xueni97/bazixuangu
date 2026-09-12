<template>
  <div class="home-page">
    <van-nav-bar title="渊海子平 · 命理选股" />

    <div class="bazi-overview" v-if="analysis">
      <div class="pillars-row">
        <div v-for="(p, i) in pillarList" :key="i" class="pillar-item">
          <div class="pillar-label">{{ p.label }}</div>
          <div class="pillar-stem" :class="'element-' + p.stemElem">
            {{ p.stem }}
          </div>
          <div class="pillar-branch" :class="'element-' + p.branchElem">
            {{ p.branch }}
          </div>
        </div>
      </div>

      <div class="info-row">
        <van-tag plain type="primary">日主 {{ analysis.dayMaster }}</van-tag>
        <van-tag plain :type="analysis.dayMasterStrength === '弱' ? 'warning' : 'success'">
          {{ analysis.dayMasterStrength }}
        </van-tag>
        <van-tag v-if="analysis.toneGod" plain type="danger">
          调候 {{ analysis.toneGod }}
        </van-tag>
      </div>

      <div class="elements-row">
        <div class="use-gods">
          <span class="label">用神</span>
          <span v-for="e in analysis.useGods" :key="e" class="element-tag" :class="'bg-' + e">
            {{ e }}
          </span>
        </div>
        <div class="avoid-gods">
          <span class="label">忌神</span>
          <span v-for="e in analysis.avoidGods" :key="e" class="element-tag muted" :class="'bg-' + e">
            {{ e }}
          </span>
        </div>
      </div>
    </div>

    <van-grid :column="3" :border="false" class="nav-grid">
      <van-grid-item icon="calendar-o" text="日方向" to="/daily" />
      <van-grid-item icon="chart-trending-o" text="周方向" to="/weekly" />
      <van-grid-item icon="underway-o" text="月方向" to="/monthly" />
      <van-grid-item icon="exchange" text="买点信号" to="/buy-point" />
      <van-grid-item icon="search" text="股票扫描" to="/scan" />
    </van-grid>

    <div class="quick-report" v-if="todayReport">
      <div class="report-title">今日速报</div>
      <div class="report-date">{{ todayReport.date }}</div>

      <div class="action-banner" :class="actionClass">
        <span class="action-icon">{{ todayReport.action }}</span>
        <span class="action-score">{{ todayReport.signalScore >= 0 ? '+' : '' }}{{ todayReport.signalScore }}</span>
      </div>

      <div class="signals-list">
        <div v-for="(s, i) in todayReport.signals" :key="i" class="signal-item">
          <van-icon name="success" v-if="s.includes('买入') || s.includes('有利') || s.includes('扶持')" color="#4caf50" />
          <van-icon name="warning" v-else-if="s.includes('谨慎') || s.includes('不胜') || s.includes('破财')" color="#ff9800" />
          <van-icon name="info" v-else color="#2196f3" />
          <span>{{ s }}</span>
        </div>
        <div v-if="!todayReport.signals.length" class="empty-signal">无明显信号</div>
      </div>

      <div class="sectors-preview">
        <div class="label">推荐板块</div>
        <div v-for="(sectors, elem) in todayReport.sectors" :key="elem" class="sector-group">
          <span class="sector-elem" :class="'element-' + elem">{{ elem }}</span>
          <span class="sector-names">{{ sectors.join('、') }}</span>
        </div>
      </div>
    </div>

    <div class="disclaimer">
      基于渊海子平传统命理推演，仅供国学研究与娱乐参考，不构成投资建议。
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import dayjs from 'dayjs'
import { BaziEngine, YuanhaiDecisionModel, STEM_ELEMENT, BRANCH_ELEMENT, ELEMENT_CSS_MAP } from '../core'

const analysis = ref(null)
const pillars = ref(null)

const pillarList = computed(() => {
  if (!pillars.value) return []
  const labels = ['年柱', '月柱', '日柱', '时柱']
  const ps = [pillars.value.year, pillars.value.month, pillars.value.day, pillars.value.hour]
  return ps.map((p, i) => ({
    label: labels[i],
    stem: p.stem,
    branch: p.branch,
    stemElem: ELEMENT_CSS_MAP[STEM_ELEMENT[p.stem]],
    branchElem: ELEMENT_CSS_MAP[BRANCH_ELEMENT[p.branch]],
  }))
})

const todayReport = computed(() => {
  if (!analysis.value) return null
  const dt = new Date()
  const daily = YuanhaiDecisionModel.daily_direction(dt)
  const bp = YuanhaiDecisionModel.buy_point_signal(dt)
  const sectors = YuanhaiDecisionModel._element_to_sectors(daily.recommendedElements.slice(0, 3))
  return {
    date: dayjs().format('YYYY-MM-DD'),
    action: bp.action,
    signalScore: bp.signalScore,
    signals: bp.signals,
    sectors,
  }
})

const actionClass = computed(() => {
  if (!todayReport.value) return ''
  const a = todayReport.value.action
  if (a.includes('买入')) return 'action-buy'
  if (a.includes('观望')) return 'action-hold'
  if (a.includes('减仓') || a.includes('卖出')) return 'action-sell'
  return 'action-try'
})

onMounted(() => {
  const dt = new Date()
  pillars.value = BaziEngine.from_datetime(dt)
  analysis.value = YuanhaiDecisionModel.analyze(pillars.value)
})
</script>

<style scoped>
.home-page { padding-bottom: 40px; }

.bazi-overview {
  margin: 12px;
  padding: 20px 16px;
  background: var(--bg-card);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
}

.pillars-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 16px;
}

.pillar-item { text-align: center; }
.pillar-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.pillar-stem, .pillar-branch {
  font-size: 22px;
  font-weight: bold;
  line-height: 1.6;
}

.info-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.elements-row { margin-top: 8px; }
.use-gods, .avoid-gods {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.elements-row .label { font-size: 12px; color: var(--text-secondary); width: 32px; }
.element-tag {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 13px;
  border: 1px solid;
}
.element-tag.muted { opacity: 0.5; }

.nav-grid { margin: 12px 0; }

.quick-report {
  margin: 12px;
  padding: 16px;
  background: var(--bg-card);
  border-radius: 12px;
}

.report-title { font-size: 16px; font-weight: bold; }
.report-date { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }

.action-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.action-banner .action-icon { font-size: 20px; font-weight: bold; }
.action-banner .action-score { font-size: 24px; font-weight: bold; }
.action-buy { background: rgba(76,175,80,0.2); border: 1px solid var(--wood); }
.action-hold { background: rgba(33,150,243,0.15); border: 1px solid var(--water); }
.action-sell { background: rgba(244,67,54,0.15); border: 1px solid var(--fire); }
.action-try { background: rgba(255,152,0,0.15); border: 1px solid var(--earth); }

.signals-list { margin-bottom: 16px; }
.signal-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
}

.sectors-preview { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; }
.sectors-preview .label { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.sector-group { margin-bottom: 6px; display: flex; gap: 8px; align-items: baseline; }
.sector-elem { font-weight: bold; min-width: 20px; }
.sector-names { font-size: 13px; color: var(--text-secondary); }

.disclaimer {
  margin: 16px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
  opacity: 0.6;
}
</style>
