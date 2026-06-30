import { createCompositor } from './compositor'
import { waitForEntryRuntime } from './entry-context'
import { changeResolution } from './resolution'
import { createRuntimeTracer } from './runtime-tracer'

interface RecordOptions extends MediaRecorderOptions {
  frameRequestRate: number
}

const DEFAULT_WIDTH = 2560
const DEFAULT_HEIGHT = 1440
const DEFAULT_FPS = 30
const VIDEO_BITS_PER_SECOND = 16_000_000

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

void startRecording()

async function startRecording() {
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
  let cleanupTrace = () => {}
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

    const tracer = createRuntimeTracer(runtime.Entry)
    cleanupTrace = tracer.dispose

    const useWebGL = !!runtime.Entry.options?.useWebGL
    const app = useWebGL ? runtime.Entry.stage?._app : null
    const originalRender = typeof app?.render === 'function' ? app.render.bind(app) : null
    const compositor = createCompositor(runtime.canvas, DEFAULT_WIDTH, DEFAULT_HEIGHT, tracer, { manual: !!originalRender })
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

    runtime.Entry.addEventListener('stop', () => {
      stopRecording(recorder)
    })

    if (!runtime.Entry.engine.isState('run')) {
      runtime.Entry.engine.toggleRun()
    }
  } catch (error) {
    console.error('[Entry Recorder] 녹화를 시작하지 못했습니다.', error)
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
