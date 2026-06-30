import type { RuntimeTraceSnapshot } from './runtime-tracer'

const PANEL_RATIO = 0.32

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const source = String(text || '')
  if (ctx.measureText(source).width <= maxWidth) return source

  let next = source
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1)
  }
  return `${next}...`
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  words.forEach(word => {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate
      return
    }

    if (line) lines.push(line)
    line = word
  })

  if (line) lines.push(line)
  if (!lines.length) lines.push('')

  if (lines.length <= maxLines) return lines

  const limited = lines.slice(0, maxLines)
  limited[maxLines - 1] = fitText(ctx, limited[maxLines - 1], maxWidth)
  return limited
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: RuntimeTraceSnapshot
) {
  const panelWidth = Math.round(width * PANEL_RATIO)
  const margin = Math.round(width * 0.025)
  const x = width - panelWidth - margin
  const y = margin
  const panelHeight = Math.round(height * 0.42)
  const padding = Math.round(width * 0.015)

  ctx.save()
  drawRoundRect(ctx, x, y, panelWidth, panelHeight, Math.round(width * 0.008))
  ctx.fillStyle = 'rgba(8, 12, 18, 0.78)'
  ctx.fill()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.fillRect(x + padding, y + padding * 2.45, panelWidth - padding * 2, 1)

  ctx.fillStyle = '#8be9fd'
  ctx.font = `600 ${Math.max(18, Math.round(width * 0.012))}px Arial, sans-serif`
  ctx.fillText('실행 중인 코드', x + padding, y + padding * 1.55)

  const current = snapshot.current
  const bodyX = x + padding
  const bodyWidth = panelWidth - padding * 2
  let cursorY = y + padding * 3.8

  if (current) {
    ctx.fillStyle = '#f8fafc'
    ctx.font = `700 ${Math.max(24, Math.round(width * 0.017))}px Arial, sans-serif`
    const currentLines = wrapText(ctx, current.label, bodyWidth, 3)
    currentLines.forEach(line => {
      ctx.fillText(line, bodyX, cursorY)
      cursorY += Math.round(width * 0.023)
    })

    ctx.fillStyle = '#cbd5e1'
    ctx.font = `500 ${Math.max(16, Math.round(width * 0.01))}px Arial, sans-serif`
    ctx.fillText(fitText(ctx, current.objectName + (current.isClone ? ' (복제본)' : ''), bodyWidth), bodyX, cursorY + padding * 0.6)
    cursorY += padding * 2.3
  } else {
    ctx.fillStyle = '#cbd5e1'
    ctx.font = `600 ${Math.max(22, Math.round(width * 0.014))}px Arial, sans-serif`
    ctx.fillText('실행을 기다리는 중', bodyX, cursorY)
    cursorY += padding * 2.2
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.fillRect(bodyX, cursorY, bodyWidth, 1)
  cursorY += padding * 1.35

  ctx.font = `500 ${Math.max(14, Math.round(width * 0.009))}px Arial, sans-serif`
  snapshot.recent.slice(0, 4).forEach((event, index) => {
    ctx.fillStyle = index === 0 ? '#e2e8f0' : '#94a3b8'
    ctx.fillText(fitText(ctx, `${index + 1}. ${event.label}`, bodyWidth), bodyX, cursorY)
    cursorY += Math.round(width * 0.014)
  })

  ctx.restore()
}
