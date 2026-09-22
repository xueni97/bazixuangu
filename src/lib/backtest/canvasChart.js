/**
 * Canvas 图表自绘（无外部依赖）。
 *
 * - drawEquityCurve: 净值折线图，零轴虚线，涨红跌绿
 * - drawHistogram: 柱状图，用于周/月收益
 *
 * 使用 window.devicePixelRatio 适配高分屏。
 */

const COLOR_UP = '#f44336'    // 涨红
const COLOR_DOWN = '#4caf50'  // 跌绿
const COLOR_ZERO = '#666'
const COLOR_GRID = 'rgba(255,255,255,0.06)'
const COLOR_AXIS = 'rgba(255,255,255,0.25)'
const COLOR_TEXT = 'rgba(255,255,255,0.5)'
const COLOR_LINE = '#2196f3'
const COLOR_FILL = 'rgba(33,150,243,0.1)'

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = rect.width || canvas.clientWidth || 320
  const h = rect.height || canvas.clientHeight || 200
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  return { ctx, w, h }
}

function drawAxis(ctx, w, h, padding) {
  const { left, right, top, bottom } = padding
  // 水平网格线
  ctx.strokeStyle = COLOR_GRID
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = top + (h - top - bottom) * i / 4
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(w - right, y)
    ctx.stroke()
  }
}

/**
 * 绘制净值折线图。
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{date:string, totalReturn:number}>} points
 * @param {object} opts - { showZeroLine: true }
 */
export function drawEquityCurve(canvas, points, opts = {}) {
  if (!canvas || !points || !points.length) return
  const { ctx, w, h } = setupCanvas(canvas)
  const padding = { left: 8, right: 8, top: 12, bottom: 18 }
  const plotW = w - padding.left - padding.right
  const plotH = h - padding.top - padding.bottom

  ctx.clearRect(0, 0, w, h)

  const returns = points.map((p) => p.totalReturn)
  let minR = Math.min(...returns, 0)
  let maxR = Math.max(...returns, 0)
  if (minR === maxR) { minR -= 1; maxR += 1 }
  const range = maxR - minR

  drawAxis(ctx, w, h, padding)

  // 零轴
  if (opts.showZeroLine !== false && minR < 0 && maxR > 0) {
    const zeroY = padding.top + plotH * (maxR / range)
    ctx.strokeStyle = COLOR_AXIS
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(padding.left, zeroY)
    ctx.lineTo(w - padding.right, zeroY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 填充区域
  const xStep = plotW / Math.max(1, points.length - 1)
  ctx.beginPath()
  const zeroY = padding.top + plotH * (maxR / range)
  ctx.moveTo(padding.left, zeroY)
  for (let i = 0; i < points.length; i++) {
    const x = padding.left + xStep * i
    const y = padding.top + plotH * (1 - (returns[i] - minR) / range)
    ctx.lineTo(x, y)
  }
  ctx.lineTo(padding.left + xStep * (points.length - 1), zeroY)
  ctx.closePath()
  ctx.fillStyle = COLOR_FILL
  ctx.fill()

  // 折线
  ctx.strokeStyle = COLOR_LINE
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i < points.length; i++) {
    const x = padding.left + xStep * i
    const y = padding.top + plotH * (1 - (returns[i] - minR) / range)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // 末点标记
  const lastIdx = points.length - 1
  const lastX = padding.left + xStep * lastIdx
  const lastY = padding.top + plotH * (1 - (returns[lastIdx] - minR) / range)
  const lastColor = returns[lastIdx] >= 0 ? COLOR_UP : COLOR_DOWN
  ctx.fillStyle = lastColor
  ctx.beginPath()
  ctx.arc(lastX, lastY, 3, 0, Math.PI * 2)
  ctx.fill()

  // 末点标签
  ctx.fillStyle = lastColor
  ctx.font = '11px monospace'
  ctx.textAlign = 'right'
  ctx.fillText(
    (returns[lastIdx] > 0 ? '+' : '') + returns[lastIdx].toFixed(1) + '%',
    lastX - 6,
    lastY - 6,
  )

  // 日期标签（首末）
  ctx.fillStyle = COLOR_TEXT
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(points[0].date.slice(5), padding.left, h - 4)
  ctx.textAlign = 'right'
  ctx.fillText(points[points.length - 1].date.slice(5), w - padding.right, h - 4)
}

/**
 * 绘制柱状图（周/月收益）。
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{date:string, totalReturn:number}>} points
 */
export function drawHistogram(canvas, points) {
  if (!canvas || !points || !points.length) return
  const { ctx, w, h } = setupCanvas(canvas)
  const padding = { left: 8, right: 8, top: 12, bottom: 18 }
  const plotW = w - padding.left - padding.right
  const plotH = h - padding.top - padding.bottom

  ctx.clearRect(0, 0, w, h)

  const returns = points.map((p) => p.totalReturn)
  let minR = Math.min(...returns, 0)
  let maxR = Math.max(...returns, 0)
  if (minR === maxR) { minR -= 1; maxR += 1 }
  const range = maxR - minR

  drawAxis(ctx, w, h, padding)

  // 零轴
  const zeroY = padding.top + plotH * (maxR / range)
  ctx.strokeStyle = COLOR_AXIS
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(padding.left, zeroY)
  ctx.lineTo(w - padding.right, zeroY)
  ctx.stroke()
  ctx.setLineDash([])

  // 柱子
  const barW = Math.max(2, plotW / points.length * 0.7)
  const gap = plotW / points.length
  for (let i = 0; i < points.length; i++) {
    const x = padding.left + gap * i + (gap - barW) / 2
    const val = returns[i]
    const barH = Math.abs(val) / range * plotH
    const y = val >= 0 ? zeroY - barH : zeroY
    ctx.fillStyle = val >= 0 ? COLOR_UP : COLOR_DOWN
    ctx.fillRect(x, y, barW, barH)
  }

  // 日期标签（首末）
  ctx.fillStyle = COLOR_TEXT
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(points[0].date.slice(5), padding.left, h - 4)
  ctx.textAlign = 'right'
  ctx.fillText(points[points.length - 1].date.slice(5), w - padding.right, h - 4)
}
