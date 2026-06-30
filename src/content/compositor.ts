import { drawOverlay } from './overlay-renderer'
import type { RuntimeTraceSnapshot } from './runtime-tracer'

interface TraceSource {
  getSnapshot(): RuntimeTraceSnapshot
}

interface CompositorOptions {
  manual?: boolean
}

export function createCompositor(
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  traceSource: TraceSource,
  { manual = false }: CompositorOptions = {}
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('녹화용 캔버스를 만들 수 없습니다.')
  const context = ctx

  let frame = 0
  let running = false

  function drawFrame() {
    context.clearRect(0, 0, width, height)
    context.drawImage(sourceCanvas, 0, 0, width, height)
    drawOverlay(context, width, height, traceSource.getSnapshot())
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
      drawFrame()
      if (!manual) frame = requestAnimationFrame(draw)
    },
    stop() {
      running = false
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
