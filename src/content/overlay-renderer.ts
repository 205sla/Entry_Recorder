import type { ActiveStackImage, RunningBlockEvent, RunningBlockToken, RuntimeTraceSnapshot } from './runtime-tracer'

const FONT_FAMILY = `"Nanum Gothic", "Noto Sans KR", Arial, sans-serif`
const PANEL_RATIO = 0.38
const DENSE_PANEL_RATIO = 0.44
const MAX_BLOCKS = 5
const OBJECT_ACCENTS = ['#111827', '#2563EB', '#16A34A', '#EA580C', '#9333EA', '#0F766E', '#DB2777']
const assemblyPatternCache = new Map<string, CanvasPattern | null>()

export type OverlayRenderMode = 'overlay' | 'fullscreen-code' | 'fullscreen-code-over-project'

interface DrawOverlayOptions {
  mode?: OverlayRenderMode
}

interface StackImageDrawOptions {
  background?: boolean
  align?: 'start' | 'center'
  shadow?: boolean
}

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

function hashText(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function getObjectAccent(event: RunningBlockEvent | null) {
  if (!event) return OBJECT_ACCENTS[0]
  return OBJECT_ACCENTS[hashText(event.objectId || event.objectName) % OBJECT_ACCENTS.length]
}

function getObjectLabel(event: RunningBlockEvent | null) {
  if (!event) return '오브젝트'
  return event.objectName + (event.isClone ? ' (복제본)' : '')
}

function getObjectInitial(event: RunningBlockEvent | null) {
  const label = getObjectLabel(event).replace(/\s+/g, '')
  return Array.from(label)[0] || 'O'
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

function drawAssemblyBackground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  radius: number
) {
  ctx.save()
  drawRoundRect(ctx, x, y, w, h, radius)
  ctx.clip()

  ctx.fillStyle = '#F8FDFF'
  ctx.fillRect(x, y, w, h)

  const gap = Math.max(9, Math.round(13 * scale))
  const dot = Math.max(1, Math.round(2 * scale))
  const pattern = getAssemblyPattern(ctx, gap, dot)

  if (pattern) {
    ctx.fillStyle = pattern
    ctx.fillRect(x, y, w, h)
    ctx.restore()
    return
  }

  ctx.fillStyle = 'rgba(129, 212, 245, 0.34)'
  const startX = x + gap - (((x % gap) + gap) % gap)
  const startY = y + gap - (((y % gap) + gap) % gap)

  for (let dotY = startY; dotY < y + h; dotY += gap) {
    for (let dotX = startX; dotX < x + w; dotX += gap) {
      ctx.fillRect(Math.round(dotX), Math.round(dotY), dot, dot)
    }
  }

  ctx.restore()
}

function getAssemblyPattern(ctx: CanvasRenderingContext2D, gap: number, dot: number) {
  if (typeof ctx.createPattern !== 'function') return null

  const key = `${gap}:${dot}`
  if (assemblyPatternCache.has(key)) return assemblyPatternCache.get(key) || null

  const ownerDocument = ctx.canvas?.ownerDocument || document
  const tile = ownerDocument.createElement('canvas')
  tile.width = gap
  tile.height = gap

  const tileCtx = tile.getContext('2d')
  if (!tileCtx) {
    assemblyPatternCache.set(key, null)
    return null
  }

  tileCtx.fillStyle = 'rgba(129, 212, 245, 0.34)'
  tileCtx.fillRect(0, 0, dot, dot)

  const pattern = ctx.createPattern(tile, 'repeat')
  assemblyPatternCache.set(key, pattern)
  return pattern
}

function strokeAssemblyFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  radius: number
) {
  drawRoundRect(ctx, x, y, w, h, radius)
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.95)'
  ctx.lineWidth = Math.max(1, Math.round(1.2 * scale))
  ctx.stroke()
}

function drawObjectMarker(
  ctx: CanvasRenderingContext2D,
  event: RunningBlockEvent | null,
  x: number,
  y: number,
  size: number,
  scale: number
) {
  const radius = Math.round(6 * scale)
  drawRoundRect(ctx, x, y, size, size, radius)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.strokeStyle = '#D7EAF5'
  ctx.lineWidth = Math.max(1, scale)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(x + size / 2, y + size / 2, size * 0.32, 0, Math.PI * 2)
  ctx.fillStyle = getObjectAccent(event)
  ctx.fill()

  ctx.fillStyle = '#FFFFFF'
  ctx.font = `800 ${Math.max(9, Math.round(size * 0.38))}px ${FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(getObjectInitial(event), x + size / 2, y + size / 2 + Math.round(0.5 * scale))
  ctx.textAlign = 'left'
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
  const objectName = getObjectLabel(current)
  const fontSize = Math.max(18, Math.round(22 * scale))

  drawObjectMarker(ctx, current, x, y, Math.round(34 * scale), scale)

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

function drawStackHeader(
  ctx: CanvasRenderingContext2D,
  stack: ActiveStackImage,
  x: number,
  y: number,
  width: number,
  scale: number
) {
  const compact = width < 160 * scale
  const markerSize = Math.round((compact ? 22 : 26) * scale)
  const fontSize = Math.max(11, Math.round((compact ? 13 : 15) * scale))
  const badgeFontSize = Math.max(10, Math.round((compact ? 12 : 13) * scale))
  const headerMiddle = y + markerSize / 2
  const blockCount = Math.max(1, stack.stackImage.blockCount || 1)
  const badgeText = compact ? `${blockCount}개` : `블록 ${blockCount}개`

  drawObjectMarker(ctx, stack.event, x, y, markerSize, scale)

  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`
  ctx.fillStyle = '#1F2937'
  ctx.textBaseline = 'middle'

  const badgePadding = Math.round(11 * scale)
  ctx.font = `700 ${badgeFontSize}px ${FONT_FAMILY}`
  const preferredBadgeWidth = ctx.measureText(badgeText).width + badgePadding * 2
  const badgeWidth = Math.min(Math.max(Math.round((compact ? 38 : 54) * scale), preferredBadgeWidth), width * (compact ? 0.34 : 0.44))
  const badgeHeight = Math.round(24 * scale)
  const badgeX = x + width - badgeWidth
  const badgeY = y + Math.round(1 * scale)

  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`
  const nameX = x + markerSize + Math.round(10 * scale)
  const nameMaxWidth = Math.max(24 * scale, badgeX - nameX - Math.round(8 * scale))
  ctx.fillText(fitText(ctx, getObjectLabel(stack.event), nameMaxWidth), nameX, headerMiddle)

  drawRoundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.strokeStyle = '#CBD5E1'
  ctx.lineWidth = Math.max(1, scale)
  ctx.stroke()

  ctx.font = `700 ${badgeFontSize}px ${FONT_FAMILY}`
  ctx.fillStyle = '#475569'
  ctx.fillText(
    fitText(ctx, badgeText, badgeWidth - badgePadding * 1.2),
    badgeX + badgePadding,
    badgeY + badgeHeight / 2
  )
}

function drawStackImage(
  ctx: CanvasRenderingContext2D,
  stack: ActiveStackImage,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  maxScale = 2.4,
  options: StackImageDrawOptions = {}
) {
  const stackImage = stack.stackImage
  const image = stackImage?.status === 'ready' ? stackImage.image : null
  if (!image) return false

  const sourceWidth = stackImage?.width || image.naturalWidth || image.width
  const sourceHeight = stackImage?.height || image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) return false

  const radius = Math.round(8 * scale)
  const headerHeight = Math.round(34 * scale)
  const imagePadding = Math.round(12 * scale)
  const imageTop = y + headerHeight + Math.round(10 * scale)
  const imageHeight = height - headerHeight - Math.round(10 * scale)
  const maxWidth = width - imagePadding * 2
  const maxHeight = imageHeight - imagePadding
  if (maxWidth <= 0 || maxHeight <= 0) return false

  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, maxScale)
  const drawWidth = Math.max(1, Math.round(sourceWidth * ratio))
  const drawHeight = Math.max(1, Math.round(sourceHeight * ratio))
  const drawX = options.align === 'center'
    ? x + Math.round((width - drawWidth) / 2)
    : x + imagePadding
  const drawY = options.align === 'center'
    ? imageTop + Math.round(Math.max(imagePadding / 2, (maxHeight - drawHeight) / 2))
    : imageTop + Math.round(imagePadding / 2)

  ctx.save()
  if (options.background !== false) {
    drawAssemblyBackground(ctx, x, y, width, height, scale, radius)
    strokeAssemblyFrame(ctx, x, y, width, height, scale, radius)
  }
  drawStackHeader(ctx, stack, x + imagePadding, y + imagePadding, width - imagePadding * 2, scale)

  try {
    if (options.shadow !== false) {
      ctx.shadowColor = 'rgba(15, 23, 42, 0.13)'
      ctx.shadowBlur = Math.round(10 * scale)
      ctx.shadowOffsetY = Math.round(2 * scale)
    }
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  } catch {
    ctx.restore()
    return false
  }

  ctx.restore()
  return true
}

function getReadyStackImages(snapshot: RuntimeTraceSnapshot): ActiveStackImage[] {
  const stacks = snapshot.stackImages.filter(stack =>
    stack.stackImage.status === 'ready' && !!stack.stackImage.image
  )

  if (stacks.length) return stacks

  if (snapshot.current && snapshot.stackImage?.status === 'ready' && snapshot.stackImage.image) {
    return [{ event: snapshot.current, stackImage: snapshot.stackImage }]
  }

  return []
}

function getGridSize(count: number, width: number, height: number) {
  const columns = clamp(Math.ceil(Math.sqrt(count * (width / Math.max(1, height)))), 1, count)
  return {
    columns,
    rows: Math.ceil(count / columns),
  }
}

function drawStackImagesPanel(
  ctx: CanvasRenderingContext2D,
  snapshot: RuntimeTraceSnapshot,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number
) {
  const stacks = getReadyStackImages(snapshot)
  if (!stacks.length) return false

  if (stacks.length === 1) {
    return drawStackImage(ctx, stacks[0], x, y, width, height, scale)
  }

  const gap = Math.round(12 * scale)
  const { columns, rows } = getGridSize(stacks.length, width, height)
  const cellWidth = (width - gap * (columns - 1)) / columns
  const cellHeight = (height - gap * (rows - 1)) / rows

  let drewAny = false
  stacks.forEach((stack, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const cellX = x + column * (cellWidth + gap)
    const cellY = y + row * (cellHeight + gap)
    drewAny = drawStackImage(ctx, stack, cellX, cellY, cellWidth, cellHeight, scale, 2.1) || drewAny
  })

  return drewAny
}

function drawFullscreenStackImages(
  ctx: CanvasRenderingContext2D,
  snapshot: RuntimeTraceSnapshot,
  width: number,
  height: number
) {
  const stacks = getReadyStackImages(snapshot)
  if (!stacks.length) return false

  const scale = clamp(width / 1280, 1.25, 2.45)
  const marginX = Math.round(width * 0.035)
  const marginY = Math.round(height * 0.045)
  const availableWidth = width - marginX * 2
  const availableHeight = height - marginY * 2
  if (availableWidth <= 0 || availableHeight <= 0) return false

  const options: StackImageDrawOptions = {
    align: 'center',
    background: false,
    shadow: false,
  }

  if (stacks.length === 1) {
    return drawStackImage(
      ctx,
      stacks[0],
      marginX,
      marginY,
      availableWidth,
      availableHeight,
      scale,
      6,
      options
    )
  }

  const gap = Math.round(18 * scale)
  const { columns, rows } = getGridSize(stacks.length, availableWidth, availableHeight)
  const cellWidth = (availableWidth - gap * (columns - 1)) / columns
  const cellHeight = (availableHeight - gap * (rows - 1)) / rows
  const maxImageScale = clamp(6 - stacks.length * 0.2, 3.2, 5.4)

  let drewAny = false
  stacks.forEach((stack, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const cellX = marginX + column * (cellWidth + gap)
    const cellY = marginY + row * (cellHeight + gap)
    drewAny = drawStackImage(ctx, stack, cellX, cellY, cellWidth, cellHeight, scale, maxImageScale, options) || drewAny
  })

  return drewAny
}

function getDisplayEvents(snapshot: RuntimeTraceSnapshot) {
  const events = snapshot.recent.slice(0, MAX_BLOCKS).reverse()
  if (snapshot.current && !events.some(event => event === snapshot.current)) {
    events.push(snapshot.current)
  }
  return events.slice(-MAX_BLOCKS)
}

function drawFullscreenFallbackBlocks(
  ctx: CanvasRenderingContext2D,
  snapshot: RuntimeTraceSnapshot,
  width: number,
  height: number
) {
  const events = getDisplayEvents(snapshot)
  if (!events.length) return

  const scale = clamp(width / 1440, 1.2, 2.4)
  const marginX = Math.round(width * 0.07)
  const blockMaxWidth = width - marginX * 2
  let cursorY = Math.round(height * 0.08)
  const maxY = height - Math.round(height * 0.06)

  events.forEach(event => {
    if (cursorY >= maxY) return
    const current = event === snapshot.current
    const blockHeight = drawBlock(ctx, event, marginX, cursorY, blockMaxWidth, scale, current)
    cursorY += blockHeight + Math.round(14 * scale)
  })
}

function drawFullscreenCodeOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: RuntimeTraceSnapshot
) {
  ctx.save()
  if (!drawFullscreenStackImages(ctx, snapshot, width, height)) {
    drawFullscreenFallbackBlocks(ctx, snapshot, width, height)
  }
  ctx.restore()
}

function drawDockedOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: RuntimeTraceSnapshot
) {
  const scale = clamp(width / 2560, 0.72, 1.25)
  const margin = Math.round(width * 0.025)
  const readyStackCount = getReadyStackImages(snapshot).length
  const denseStacks = readyStackCount > 1
  const panelWidth = Math.round(Math.min(width * (denseStacks ? DENSE_PANEL_RATIO : PANEL_RATIO), (denseStacks ? 1040 : 880) * scale))
  const panelHeight = Math.round(Math.min(height * (denseStacks ? 0.52 : 0.48), (denseStacks ? 640 : 560) * scale))
  const x = width - panelWidth - margin
  const y = margin
  const padding = Math.round(24 * scale)

  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.18)'
  ctx.shadowBlur = Math.round(24 * scale)
  ctx.shadowOffsetY = Math.round(8 * scale)
  drawAssemblyBackground(ctx, x, y, panelWidth, panelHeight, scale, Math.round(10 * scale))
  strokeAssemblyFrame(ctx, x, y, panelWidth, panelHeight, scale, Math.round(10 * scale))
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  const blockX = x + padding
  const blockMaxWidth = panelWidth - padding * 2
  const events = getDisplayEvents(snapshot)
  const stackImageY = y + padding
  const stackImageHeight = panelHeight - padding * 2

  if (drawStackImagesPanel(ctx, snapshot, blockX, stackImageY, blockMaxWidth, stackImageHeight, scale)) {
    ctx.restore()
    return
  }

  drawHeader(ctx, snapshot, x + padding, y + padding, panelWidth - padding * 2, scale)

  let cursorY = y + padding + Math.round(58 * scale)

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

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: RuntimeTraceSnapshot,
  options: DrawOverlayOptions = {}
) {
  if (options.mode === 'fullscreen-code' || options.mode === 'fullscreen-code-over-project') {
    drawFullscreenCodeOverlay(ctx, width, height, snapshot)
    return
  }

  drawDockedOverlay(ctx, width, height, snapshot)
}
