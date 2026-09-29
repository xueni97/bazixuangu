import { YuanhaiDecisionModel } from './src/lib/metaphysics/model.js'
import { getAlmanac } from './src/lib/metaphysics/almanac.js'

for (const d of ['2026-09-17', '2026-09-22', '2026-09-23', '2026-09-28']) {
  const dt = new Date(d + 'T12:00:00')
  const sig = YuanhaiDecisionModel.weightedBuyPointSignal(dt)
  const alm = getAlmanac(dt)
  console.log(`\n${d}: action=${sig.action} score=${sig.signalScore} vetoed=${sig.vetoed}`)
  console.log(`  黄历: 凶=${alm.inauspicious} 值星=${alm.officer} reasons=${alm.reasons.join('/') || '无'} 干支=${alm.pillars}`)
  for (const p of ['monthly', 'weekly', 'daily']) {
    const pd = sig.periodDetail[p]
    if (pd) console.log(`  ${p}: ${pd.action}(${pd.signalScore})`)
  }
  if (sig.signals.length) {
    console.log(`  信号:`)
    for (const s of sig.signals.slice(0, 4)) console.log(`    ${s}`)
  }
}
