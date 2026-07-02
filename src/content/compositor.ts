import { drawOverlay } from './overlay-renderer'
import type { RuntimeTraceSnapshot } from './runtime-tracer'

const FRAME_THROTTLE_TOLERANCE_MS = 8

interface TraceSource {
  getSnapshot(): RuntimeTraceSnapshot
}

interface CompositorOptions {
  frameRate?: number
  manual?: boolean
}

function getEventKey(event: RuntimeTraceSnapshot['current']) {
  if (!event) return 'none'
  return [
    event.time,
    event.objectId,
    event.objectName,
    event.blockId,
    event.blockType,
    event.isClone ? 'clone' : 'object',
  ].join(':')
}

function getStackImageKey(stackImage: RuntimeTraceSnapshot['stackImage']) {
  if (!stackImage) return 'none'
  return [
    stackImage.key,
    stackImage.status,
    stackImage.width,
    stackImage.height,
    stackImage.image ? 'image' : 'empty',
  ].join(':')
}

function getOverlayCacheKey(snapshot: RuntimeTraceSnapshot) {
  return [
    getEventKey(snapshot.current),
    snapshot.recent.map(getEventKey).join(','),
    getStackImageKey(snapshot.stackImage),
    snapshot.stackImages
      .map(stack => `${getEventKey(stack.event)}=${getStackImageKey(stack.stackImage)}`)
      .join(','),
  ].join('|')
}

export function createCompositor(
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  traceSource: TraceSource,
  { frameRate = 30, manual = false }: CompositorOptions = {}
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const overlayCanvas = document.createElement('canvas')
  overlayCanvas.width = width
  overlayCanvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('녹화용 캔버스를 만들 수 없습니다.')
  const context = ctx
  const overlayCtx = overlayCanvas.getContext('2d')
  if (!overlayCtx) throw new Error('녹화용 오버레이 캔버스를 만들 수 없습니다.')
  const overlayContext = overlayCtx

  const frameIntervalMs = 1000 / frameRate
  let frame = 0
  let lastDrawAt = -Infinity
  let overlayCacheKey = ''
  let running = false

  function renderOverlay(snapshot: RuntimeTraceSnapshot) {
    const nextKey = getOverlayCacheKey(snapshot)
    if (nextKey === overlayCacheKey) return

    overlayContext.clearRect(0, 0, width, height)
    drawOverlay(overlayContext, width, height, snapshot)
    overlayCacheKey = nextKey
  }

  function drawFrame(force = false) {
    const now = performance.now()
    const throttleThresholdMs = Math.max(0, frameIntervalMs - FRAME_THROTTLE_TOLERANCE_MS)
    if (!force && now - lastDrawAt < throttleThresholdMs) return false
    lastDrawAt = now

    const snapshot = traceSource.getSnapshot()
    context.clearRect(0, 0, width, height)
    context.drawImage(sourceCanvas, 0, 0, width, height)
    renderOverlay(snapshot)
    context.drawImage(overlayCanvas, 0, 0)
    return true
  }

  function draw() {
    drawFrame()
    if (running) frame = requestAnimationFrame(draw)
  }

  return {
    canvas,
    drawFrame,
    start() {
      if (running) return
      running = true
      drawFrame(true)
      lastDrawAt = -Infinity
      if (!manual) frame = requestAnimationFrame(draw)
    },
    stop() {
      running = false
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
