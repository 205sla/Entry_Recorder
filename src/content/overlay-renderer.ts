import type { RunningBlockEvent, RunningBlockToken, RuntimeTraceSnapshot } from './runtime-tracer'

const FONT_FAMILY = `"Nanum Gothic", "Noto Sans KR", Arial, sans-serif`
const PANEL_RATIO = 0.38
const MAX_BLOCKS = 5

interface TokenLayout {
  kind: RunningBlockToken['kind']
  text: string
  width: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

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

function drawStackBlockPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, notch: number) {
  const radius = Math.min(h / 2, 18)
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + notch * 0.75, y + notch)
  ctx.lineTo(x + notch * 1.5, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + notch * 1.5, y + h)
  ctx.lineTo(x + notch * 0.75, y + h + notch)
  ctx.lineTo(x, y + h)
  ctx.closePath()
}

function drawEventBlockPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const radius = h / 2
  ctx.beginPath()
  ctx.moveTo(x + 28, y + h)
  ctx.lineTo(x + 18, y + h + 10)
  ctx.lineTo(x + 8, y + h)
  ctx.arcTo(x, y + h, x, y + radius, radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
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

function normalizeTokens(event: RunningBlockEvent): RunningBlockToken[] {
  const tokens = event.tokens?.filter(token => token.text.trim()) || []
  return tokens.length ? tokens : [{ kind: 'text', text: event.label }]
}

function createTokenLayout(
  ctx: CanvasRenderingContext2D,
  event: RunningBlockEvent,
  maxWidth: number,
  fontSize: number
): TokenLayout[] {
  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`
  const tokens = normalizeTokens(event)
  const gap = Math.round(fontSize * 0.45)
  const paramPadding = Math.round(fontSize * 0.95)

  const layouts = tokens.map(token => {
    const text = token.text
    const measured = ctx.measureText(text).width
    return {
      kind: token.kind,
      text,
      width: token.kind === 'param' ? Math.max(fontSize * 1.8, measured + paramPadding) : measured,
    }
  })

  const totalWidth = layouts.reduce((sum, layout, index) => sum + layout.width + (index ? gap : 0), 0)
  if (totalWidth <= maxWidth) return layouts

  return [{
    kind: 'text',
    text: fitText(ctx, event.label, maxWidth),
    width: Math.min(maxWidth, ctx.measureText(fitText(ctx, event.label, maxWidth)).width),
  }]
}

function measureTokens(layouts: TokenLayout[], gap: number) {
  return layouts.reduce((sum, layout, index) => sum + layout.width + (index ? gap : 0), 0)
}

function drawTokens(
  ctx: CanvasRenderingContext2D,
  layouts: TokenLayout[],
  x: number,
  y: number,
  fontSize: number,
  scale: number
) {
  const gap = Math.round(fontSize * 0.45)
  const capsuleHeight = Math.round(fontSize * 1.45)
  let cursorX = x

  ctx.textBaseline = 'middle'
  layouts.forEach(layout => {
    if (layout.kind === 'param') {
      drawRoundRect(ctx, cursorX, y - capsuleHeight / 2, layout.width, capsuleHeight, capsuleHeight / 2)
      ctx.fillStyle = '#FFF1A8'
      ctx.fill()
      ctx.strokeStyle = '#FF9C00'
      ctx.lineWidth = Math.max(2, 2 * scale)
      ctx.stroke()

      ctx.fillStyle = '#7C2D12'
      ctx.font = `800 ${fontSize}px ${FONT_FAMILY}`
      ctx.fillText(layout.text, cursorX + Math.round(fontSize * 0.45), y)
      cursorX += layout.width + gap
      return
    }

    ctx.fillStyle = '#FFFFFF'
    ctx.font = `800 ${fontSize}px ${FONT_FAMILY}`
    ctx.fillText(layout.text, cursorX, y)
    cursorX += layout.width + gap
  })
}

function isEventBlock(event: RunningBlockEvent) {
  return event.skeleton.includes('event') || event.blockClass === 'event' || event.blockType.startsWith('when_')
}

function isLoopBlock(event: RunningBlockEvent) {
  return event.skeleton.includes('loop') ||
    event.blockType.includes('repeat') ||
    event.blockType === '_if' ||
    event.blockType === 'if_else'
}

function drawIndicatorIcon(
  ctx: CanvasRenderingContext2D,
  event: RunningBlockEvent,
  x: number,
  y: number,
  radius: number,
  scale: number
) {
  ctx.save()
  ctx.globalAlpha = 0.78
  drawRoundRect(ctx, x - radius, y - radius, radius * 2, radius * 2, radius)
  ctx.fillStyle = event.outerLine
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.lineWidth = Math.max(2, 2 * scale)
  ctx.beginPath()
  ctx.moveTo(x - radius * 0.35, y - radius * 0.35)
  ctx.lineTo(x + radius * 0.28, y)
  ctx.lineTo(x - radius * 0.35, y + radius * 0.35)
  ctx.stroke()
  ctx.restore()
}

function drawStartIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale: number) {
  ctx.save()
  drawRoundRect(ctx, x, y, size, size, size * 0.3)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = Math.max(2, 2 * scale)
  ctx.beginPath()
  ctx.moveTo(x + size * 0.38, y + size * 0.28)
  ctx.lineTo(x + size * 0.38, y + size * 0.72)
  ctx.lineTo(x + size * 0.72, y + size * 0.5)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  event: RunningBlockEvent,
  x: number,
  y: number,
  maxWidth: number,
  scale: number,
  current: boolean
) {
  const fontSize = Math.max(17, Math.round(22 * scale))
  const notch = Math.round(8 * scale)
  const bodyHeight = Math.round((isEventBlock(event) ? 48 : 44) * scale)
  const tokenMax = maxWidth - Math.round(76 * scale)
  const layouts = createTokenLayout(ctx, event, tokenMax, fontSize)
  const tokenWidth = measureTokens(layouts, Math.round(fontSize * 0.45))
  const blockWidth = clamp(tokenWidth + Math.round(72 * scale), Math.round(250 * scale), maxWidth)
  const loop = isLoopBlock(event)
  const totalHeight = loop ? Math.round(116 * scale) : bodyHeight + notch

  ctx.save()
  if (current) {
    ctx.shadowColor = 'rgba(250, 204, 21, 0.42)'
    ctx.shadowBlur = Math.round(18 * scale)
  }

  if (isEventBlock(event)) {
    drawEventBlockPath(ctx, x, y, blockWidth, bodyHeight)
  } else {
    drawStackBlockPath(ctx, x, y, blockWidth, bodyHeight, notch)
  }
  ctx.fillStyle = event.color
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = current ? '#FEF3C7' : event.outerLine
  ctx.lineWidth = current ? Math.max(4, 4 * scale) : Math.max(2, 2 * scale)
  ctx.stroke()

  const contentX = x + Math.round((isEventBlock(event) ? 50 : 28) * scale)
  const contentY = y + bodyHeight / 2
  if (isEventBlock(event)) {
    drawStartIcon(ctx, x + Math.round(13 * scale), y + Math.round(10 * scale), Math.round(28 * scale), scale)
  }
  drawTokens(ctx, layouts, contentX, contentY, fontSize, scale)
  drawIndicatorIcon(ctx, event, x + blockWidth - Math.round(23 * scale), contentY, Math.round(15 * scale), scale)

  if (loop) {
    const spineWidth = Math.round(28 * scale)
    const loopTop = y + bodyHeight - Math.round(3 * scale)
    const loopGap = Math.round(42 * scale)
    const bottomY = loopTop + loopGap
    ctx.fillStyle = event.color
    ctx.fillRect(x, loopTop, spineWidth, loopGap + Math.round(18 * scale))
    ctx.strokeStyle = event.outerLine
    ctx.lineWidth = Math.max(2, 2 * scale)
    ctx.strokeRect(x, loopTop, spineWidth, loopGap + Math.round(18 * scale))

    drawStackBlockPath(ctx, x, bottomY, blockWidth * 0.82, Math.round(28 * scale), notch)
    ctx.fillStyle = event.color
    ctx.fill()
    ctx.strokeStyle = event.outerLine
    ctx.stroke()

    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
    drawRoundRect(
      ctx,
      x + Math.round(42 * scale),
      loopTop + Math.round(12 * scale),
      blockWidth - Math.round(70 * scale),
      Math.round(24 * scale),
      Math.round(12 * scale)
    )
    ctx.fill()
  }

  if (current) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    drawRoundRect(
      ctx,
      x + blockWidth - Math.round(72 * scale),
      y - Math.round(12 * scale),
      Math.round(52 * scale),
      Math.round(22 * scale),
      Math.round(11 * scale)
    )
    ctx.fill()
    ctx.fillStyle = '#B91C1C'
    ctx.font = `800 ${Math.max(12, Math.round(13 * scale))}px ${FONT_FAMILY}`
    ctx.textBaseline = 'middle'
    ctx.fillText('NOW', x + blockWidth - Math.round(62 * scale), y - Math.round(1 * scale))
  }

  ctx.restore()
  return totalHeight
}

function drawGrid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number) {
  ctx.fillStyle = 'rgba(247, 253, 255, 0.94)'
  drawRoundRect(ctx, x, y, w, h, Math.round(10 * scale))
  ctx.fill()

  ctx.fillStyle = 'rgba(56, 189, 248, 0.24)'
  const gap = Math.round(16 * scale)
  const dot = Math.max(1, Math.round(2 * scale))
  for (let dotY = y + gap; dotY < y + h - gap / 2; dotY += gap) {
    for (let dotX = x + gap; dotX < x + w - gap / 2; dotX += gap) {
      ctx.fillRect(dotX, dotY, dot, dot)
    }
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  snapshot: RuntimeTraceSnapshot,
  x: number,
  y: number,
  panelWidth: number,
  scale: number
) {
  const current = snapshot.current
  const objectName = current ? current.objectName + (current.isClone ? ' (복제본)' : '') : '오브젝트'
  const fontSize = Math.max(18, Math.round(22 * scale))

  drawRoundRect(ctx, x, y, Math.round(34 * scale), Math.round(34 * scale), Math.round(8 * scale))
  ctx.fillStyle = '#F8FAFC'
  ctx.fill()
  drawRoundRect(ctx, x + Math.round(6 * scale), y + Math.round(6 * scale), Math.round(22 * scale), Math.round(22 * scale), Math.round(11 * scale))
  ctx.fillStyle = '#111827'
  ctx.fill()

  ctx.fillStyle = '#0F172A'
  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'middle'
  ctx.fillText(fitText(ctx, objectName, panelWidth * 0.46), x + Math.round(46 * scale), y + Math.round(18 * scale))

  const badgeText = `블록 ${Math.max(1, snapshot.recent.length)}개`
  ctx.font = `700 ${Math.max(14, Math.round(16 * scale))}px ${FONT_FAMILY}`
  const badgeWidth = ctx.measureText(badgeText).width + Math.round(26 * scale)
  drawRoundRect(
    ctx,
    x + panelWidth - badgeWidth,
    y + Math.round(4 * scale),
    badgeWidth,
    Math.round(28 * scale),
    Math.round(14 * scale)
  )
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.strokeStyle = '#CBD5E1'
  ctx.lineWidth = Math.max(1, scale)
  ctx.stroke()
  ctx.fillStyle = '#475569'
  ctx.fillText(badgeText, x + panelWidth - badgeWidth + Math.round(13 * scale), y + Math.round(18 * scale))
}

function drawStackImagePanel(
  ctx: CanvasRenderingContext2D,
  snapshot: RuntimeTraceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number
) {
  const stackImage = snapshot.stackImage
  const image = stackImage?.status === 'ready' ? stackImage.image : null
  if (!image) return false

  const sourceWidth = stackImage?.width || image.naturalWidth || image.width
  const sourceHeight = stackImage?.height || image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) return false

  const imagePadding = Math.round(12 * scale)
  const maxWidth = width - imagePadding * 2
  const maxHeight = height - imagePadding * 2
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 2.4)
  const drawWidth = Math.max(1, Math.round(sourceWidth * ratio))
  const drawHeight = Math.max(1, Math.round(sourceHeight * ratio))
  const drawX = x + Math.round((width - drawWidth) / 2)
  const drawY = y + Math.round((height - drawHeight) / 2)

  ctx.save()
  drawRoundRect(ctx, x, y, width, height, Math.round(8 * scale))
  ctx.fillStyle = 'rgba(255, 255, 255, 0.48)'
  ctx.fill()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.14)'
  ctx.shadowBlur = Math.round(12 * scale)
  ctx.shadowOffsetY = Math.round(3 * scale)

  try {
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  } catch {
    ctx.restore()
    return false
  }

  ctx.restore()
  return true
}

function getDisplayEvents(snapshot: RuntimeTraceSnapshot) {
  const events = snapshot.recent.slice(0, MAX_BLOCKS).reverse()
  if (snapshot.current && !events.some(event => event === snapshot.current)) {
    events.push(snapshot.current)
  }
  return events.slice(-MAX_BLOCKS)
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: RuntimeTraceSnapshot
) {
  const scale = clamp(width / 2560, 0.72, 1.25)
  const margin = Math.round(width * 0.025)
  const panelWidth = Math.round(Math.min(width * PANEL_RATIO, 880 * scale))
  const panelHeight = Math.round(Math.min(height * 0.48, 560 * scale))
  const x = width - panelWidth - margin
  const y = margin
  const padding = Math.round(24 * scale)

  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.18)'
  ctx.shadowBlur = Math.round(24 * scale)
  ctx.shadowOffsetY = Math.round(8 * scale)
  drawGrid(ctx, x, y, panelWidth, panelHeight, scale)
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  drawHeader(ctx, snapshot, x + padding, y + padding, panelWidth - padding * 2, scale)

  const blockX = x + padding
  const blockMaxWidth = panelWidth - padding * 2
  let cursorY = y + padding + Math.round(58 * scale)
  const events = getDisplayEvents(snapshot)
  const stackImageHeight = y + panelHeight - padding - cursorY

  if (drawStackImagePanel(ctx, snapshot, blockX, cursorY, blockMaxWidth, stackImageHeight, scale)) {
    ctx.restore()
    return
  }

  if (!events.length) {
    drawRoundRect(ctx, blockX, cursorY, blockMaxWidth, Math.round(52 * scale), Math.round(14 * scale))
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.fill()
    ctx.strokeStyle = '#BAE6FD'
    ctx.lineWidth = Math.max(2, 2 * scale)
    ctx.stroke()
    ctx.fillStyle = '#64748B'
    ctx.font = `700 ${Math.max(18, Math.round(21 * scale))}px ${FONT_FAMILY}`
    ctx.textBaseline = 'middle'
    ctx.fillText('실행을 기다리는 중', blockX + Math.round(20 * scale), cursorY + Math.round(26 * scale))
    ctx.restore()
    return
  }

  events.forEach(event => {
    const current = event === snapshot.current
    const blockHeight = drawBlock(ctx, event, blockX, cursorY, blockMaxWidth, scale, current)
    cursorY += blockHeight + Math.round(8 * scale)
  })

  ctx.restore()
}
