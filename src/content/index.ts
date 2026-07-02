import { createCompositor } from './compositor'
import { waitForEntryRuntime, type EntryRuntime } from './entry-context'
import { changeResolution } from './resolution'
import { createRuntimeTracer } from './runtime-tracer'
import { createBlockStackImageCache } from './block-stack-image'
import type { OverlayRenderMode } from './overlay-renderer'

interface RecordOptions extends MediaRecorderOptions {
  frameRequestRate: number
}

declare global {
  interface Window {
    __ENTRY_RECORDER_REQUEST__?: {
      mode?: OverlayRenderMode
    }
  }
}

const DEFAULT_WIDTH = 2560
const DEFAULT_HEIGHT = 1440
const DEFAULT_FPS = 30
const VIDEO_BITS_PER_SECOND = 16_000_000

function getRecordingMode(): OverlayRenderMode {
  const mode = window.__ENTRY_RECORDER_REQUEST__?.mode
  delete window.__ENTRY_RECORDER_REQUEST__
  if (mode === 'fullscreen-code-over-project') return 'fullscreen-code-over-project'
  return mode === 'fullscreen-code' ? 'fullscreen-code' : 'overlay'
}

function getRecordingIndicatorLabel(mode: OverlayRenderMode) {
  if (mode === 'fullscreen-code') return 'REC 코드 전체 화면'
  if (mode === 'fullscreen-code-over-project') return 'REC 작품 위 코드'
  return 'REC 녹화 중'
}

function selectMediaRecorderOptions(): Partial<RecordOptions> {
  const mimeTypes = [
    'video/mp4;codecs="avc1.640032,mp4a.40.2"',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]

  const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type))
  return {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    frameRequestRate: DEFAULT_FPS,
  }
}

function createDownload(blob: Blob, extension: string) {
  const anchor = document.createElement('a')
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  anchor.href = URL.createObjectURL(blob)
  anchor.download = `entry-recording-${stamp}.${extension}`
  anchor.click()
  setTimeout(URL.revokeObjectURL, 0, anchor.href)
}

function attachEntryAudio(stream: MediaStream, createjs: any) {
  try {
    const sound = createjs?.WebAudioSoundInstance
    const audioContext = sound?.context
    const destinationNode = sound?.destinationNode

    if (!audioContext || !destinationNode) return () => {}

    const destination = typeof audioContext.createMediaStreamDestination === 'function'
      ? audioContext.createMediaStreamDestination()
      : new MediaStreamAudioDestinationNode(audioContext)

    destinationNode.connect(destination)
    destination.stream.getTracks().forEach((track: MediaStreamTrack) => stream.addTrack(track))

    return () => {
      try {
        destinationNode.disconnect(destination)
      } catch {}
    }
  } catch (error) {
    console.warn('[Entry Recorder] 오디오 트랙을 연결하지 못했습니다.', error)
    return () => {}
  }
}

function createRecordingIndicator(runtime: EntryRuntime, mode: OverlayRenderMode) {
  const id = 'entry-recorder-recording-indicator'
  const styleId = 'entry-recorder-recording-indicator-style'
  runtime.document.getElementById(id)?.remove()
  runtime.document.getElementById(styleId)?.remove()

  const style = runtime.document.createElement('style')
  style.id = styleId
  style.textContent = `
    #${id} {
      position: fixed;
      left: 14px;
      top: 14px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid rgba(248, 113, 113, 0.72);
      border-radius: 999px;
      background: rgba(8, 12, 18, 0.84);
      color: #f8fafc;
      font: 700 13px/1 Arial, sans-serif;
      letter-spacing: 0;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      pointer-events: none;
    }
    #${id} .entry-recorder-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18);
      animation: entry-recorder-pulse 1s ease-in-out infinite;
    }
    #${id} .entry-recorder-time {
      color: #cbd5e1;
      font-weight: 600;
      min-width: 40px;
    }
    @keyframes entry-recorder-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.55; transform: scale(0.72); }
    }
  `

  const indicator = runtime.document.createElement('div')
  indicator.id = id
  indicator.setAttribute('role', 'status')
  indicator.setAttribute('aria-live', 'polite')
  const label = getRecordingIndicatorLabel(mode)
  indicator.innerHTML = `<span class="entry-recorder-dot"></span><span>${label}</span><span class="entry-recorder-time">00:00</span>`

  const time = indicator.querySelector('.entry-recorder-time')
  const startedAt = Date.now()
  const updateTime = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    if (time) time.textContent = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }

  const host = runtime.document.body || runtime.document.documentElement
  runtime.document.documentElement.appendChild(style)
  host.appendChild(indicator)
  updateTime()
  const timer = runtime.window.setInterval(updateTime, 500)

  return () => {
    runtime.window.clearInterval(timer)
    indicator.remove()
    style.remove()
  }
}

function createPreparationIndicator(runtime: EntryRuntime) {
  const id = 'entry-recorder-preparation-indicator'
  const styleId = 'entry-recorder-preparation-indicator-style'
  runtime.document.getElementById(id)?.remove()
  runtime.document.getElementById(styleId)?.remove()

  const style = runtime.document.createElement('style')
  style.id = styleId
  style.textContent = `
    #${id} {
      position: fixed;
      left: 14px;
      top: 14px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 9px 13px;
      border: 1px solid rgba(56, 189, 248, 0.72);
      border-radius: 999px;
      background: rgba(8, 12, 18, 0.86);
      color: #f8fafc;
      font: 700 13px/1 Arial, sans-serif;
      letter-spacing: 0;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      pointer-events: none;
    }
    #${id} .entry-recorder-spinner {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid rgba(186, 230, 253, 0.42);
      border-top-color: #38bdf8;
      animation: entry-recorder-spin 0.75s linear infinite;
    }
    #${id} .entry-recorder-subtle {
      color: #bae6fd;
      font-weight: 600;
    }
    @keyframes entry-recorder-spin {
      to { transform: rotate(360deg); }
    }
  `

  const indicator = runtime.document.createElement('div')
  indicator.id = id
  indicator.setAttribute('role', 'status')
  indicator.setAttribute('aria-live', 'polite')
  indicator.innerHTML = '<span class="entry-recorder-spinner"></span><span>녹화 준비 중</span><span class="entry-recorder-subtle">블록 이미지 생성</span>'

  const host = runtime.document.body || runtime.document.documentElement
  runtime.document.documentElement.appendChild(style)
  host.appendChild(indicator)

  return () => {
    indicator.remove()
    style.remove()
  }
}

function createEntryStopFallback(runtime: EntryRuntime, stop: () => void) {
  let sawRunning = !!runtime.Entry.engine?.isState?.('run')

  function stopSoon() {
    runtime.window.setTimeout(stop, 0)
  }

  function onClick(event: Event) {
    const target = event.target
    if (!(target instanceof runtime.window.Element)) return

    if (target.closest('.entryStopButtonMinimize')) {
      stopSoon()
    }
  }

  const timer = runtime.window.setInterval(() => {
    const isRunning = !!runtime.Entry.engine?.isState?.('run')
    if (sawRunning && !isRunning) {
      stop()
      return
    }
    sawRunning = sawRunning || isRunning
  }, 250)

  runtime.document.addEventListener('click', onClick, true)

  return () => {
    runtime.document.removeEventListener('click', onClick, true)
    runtime.window.clearInterval(timer)
  }
}

void startRecording(getRecordingMode())

async function startRecording(mode: OverlayRenderMode) {
  if (typeof MediaRecorder === 'undefined') {
    alert('이 브라우저는 MediaRecorder 녹화를 지원하지 않습니다.')
    return
  }

  const runtime = await waitForEntryRuntime()
  if (!runtime) {
    alert('엔트리 작품 페이지가 아닙니다.')
    return
  }

  const activeSession = runtime.window.__ENTRY_RECORDER_SESSION__
  if (activeSession?.active) {
    alert('이미 녹화 중입니다.')
    return
  }

  let stopped = false
  let cleanupAudio = () => {}
  let cleanupIndicator = () => {}
  let cleanupPreparationIndicator = () => {}
  let cleanupTrace = () => {}
  let cleanupStopFallback = () => {}
  let stopCompositor = () => {}

  function stopRecording(recorder: MediaRecorder) {
    if (stopped) return
    stopped = true

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  try {
    changeResolution(runtime.Entry, DEFAULT_WIDTH, DEFAULT_HEIGHT)

    cleanupPreparationIndicator = createPreparationIndicator(runtime)
    const blockImages = createBlockStackImageCache(runtime.window, runtime.Entry)
    await blockImages.prepare()
    cleanupPreparationIndicator()
    cleanupPreparationIndicator = () => {}

    const tracer = createRuntimeTracer(runtime.Entry, runtime.window, { blockImages })
    cleanupTrace = () => {
      tracer.dispose()
      blockImages.dispose()
    }

    const useWebGL = !!runtime.Entry.options?.useWebGL
    const app = useWebGL ? runtime.Entry.stage?._app : null
    const originalRender = typeof app?.render === 'function' ? app.render.bind(app) : null
    const compositor = createCompositor(runtime.canvas, DEFAULT_WIDTH, DEFAULT_HEIGHT, tracer, {
      frameRate: DEFAULT_FPS,
      manual: !!originalRender,
      mode,
    })
    stopCompositor = compositor.stop

    if (app && originalRender) {
      app.render = () => {
        originalRender()
        compositor.drawFrame()
      }
      const prevStop = stopCompositor
      stopCompositor = () => {
        app.render = originalRender
        prevStop()
      }
    }

    compositor.start()

    const options = selectMediaRecorderOptions()
    const stream = compositor.canvas.captureStream(options.frameRequestRate)
    cleanupAudio = attachEntryAudio(stream, runtime.createjs)

    const recorder = new MediaRecorder(stream, options)
    const parts: Blob[] = []

    runtime.window.__ENTRY_RECORDER_SESSION__ = {
      active: true,
      stop: () => stopRecording(recorder),
    }

    recorder.addEventListener('dataavailable', ({ data }) => {
      if (data.size) parts.push(data)
    })

    recorder.addEventListener('stop', () => {
      cleanupStopFallback()
      cleanupIndicator()
      stopCompositor()
      cleanupTrace()
      cleanupAudio()
      stream.getTracks().forEach(track => track.stop())

      if (runtime.window.__ENTRY_RECORDER_SESSION__) {
        runtime.window.__ENTRY_RECORDER_SESSION__.active = false
        delete runtime.window.__ENTRY_RECORDER_SESSION__
      }

      if (!parts.length) return

      const type = recorder.mimeType || options.mimeType || 'video/webm'
      const extension = type.includes('mp4') ? 'mp4' : 'webm'
      createDownload(new Blob(parts, { type }), extension)
    })

    recorder.addEventListener('error', event => {
      console.error('[Entry Recorder] 녹화 오류', event)
      stopRecording(recorder)
    })

    recorder.start()
    cleanupIndicator = createRecordingIndicator(runtime, mode)

    runtime.Entry.addEventListener('stop', () => {
      stopRecording(recorder)
    })
    cleanupStopFallback = createEntryStopFallback(runtime, () => stopRecording(recorder))

    if (!runtime.Entry.engine.isState('run')) {
      runtime.Entry.engine.toggleRun()
    }
  } catch (error) {
    console.error('[Entry Recorder] 녹화를 시작하지 못했습니다.', error)
    cleanupStopFallback()
    cleanupIndicator()
    cleanupPreparationIndicator()
    stopCompositor()
    cleanupTrace()
    cleanupAudio()
    if (runtime.window.__ENTRY_RECORDER_SESSION__) {
      runtime.window.__ENTRY_RECORDER_SESSION__.active = false
      delete runtime.window.__ENTRY_RECORDER_SESSION__
    }
    alert('녹화를 시작하지 못했습니다. 콘솔 로그를 확인해주세요.')
  }
}
