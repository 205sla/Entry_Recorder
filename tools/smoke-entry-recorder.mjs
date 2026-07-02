import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const bundlePath = resolve('build/dist/content.js')
const bundleSource = readFileSync(bundlePath, 'utf8')

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type
    Object.assign(this, init)
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this
    this.listeners.get(event.type)?.forEach(listener => listener.call(this, event))
  }
}

class FakeElement extends FakeEventTarget {
  constructor(className = '', smoke = null, tagName = 'DIV') {
    super()
    this.className = className
    this.smoke = smoke
    this.tagName = tagName
    this.attributes = new Map()
    this.children = []
    this.id = ''
    this.parentNode = null
    this.textContent = ''
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
    if (child.id === 'entry-recorder-recording-indicator') this.smoke.indicatorShown += 1
    return child
  }

  remove() {
    if (this.id === 'entry-recorder-recording-indicator') this.smoke.indicatorRemoved += 1
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter(child => child !== this)
    this.parentNode = null
  }

  set innerHTML(value) {
    this._innerHTML = value
    if (String(value).includes('entry-recorder-time')) {
      this.timeElement = new FakeElement('entry-recorder-time', this.smoke, 'SPAN')
    }
  }

  get innerHTML() {
    return this._innerHTML || ''
  }

  querySelector(selector) {
    if (selector === '.entry-recorder-time') return this.timeElement || null
    return null
  }

  closest(selector) {
    if (selector === '.entryStopButtonMinimize' && this.className.split(/\s+/).includes('entryStopButtonMinimize')) {
      return this
    }

    return null
  }
}

class FakeMediaStreamTrack {
  constructor(smoke) {
    this.smoke = smoke
    this.stopped = false
  }

  stop() {
    this.stopped = true
    this.smoke.trackStopCalls += 1
    this.smoke.trackStops += 1
  }
}

class FakeMediaStream {
  constructor(smoke) {
    this.smoke = smoke
    this.tracks = [new FakeMediaStreamTrack(smoke)]
  }

  addTrack(track) {
    this.tracks.push(track)
  }

  getTracks() {
    return this.tracks.slice()
  }
}

class FakeCanvasRenderingContext2D {
  constructor(canvas, smoke) {
    this.canvas = canvas
    this.smoke = smoke
    this.fillStyle = ''
    this.font = ''
  }

  clearRect() {}
  fillRect() {}
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  arcTo() {}
  closePath() {}
  clip() {}
  fill() {}
  stroke() {}
  strokeRect() {}

  drawImage(sourceCanvas) {
    this.smoke.drawImageCalls.push({
      target: this.canvas.name,
      source: sourceCanvas?.name || 'unknown',
    })
  }

  fillText(text) {
    this.smoke.textDraws.push(String(text))
  }

  measureText(text) {
    return { width: String(text).length * 12 }
  }
}

class FakeHTMLCanvasElement {
  constructor(smoke, name = 'canvas') {
    this.smoke = smoke
    this.name = name
    this.width = 480
    this.height = 270
    this.context = new FakeCanvasRenderingContext2D(this, smoke)
  }

  getContext(type) {
    return type === '2d' ? this.context : null
  }

  captureStream(frameRate) {
    this.smoke.captureStreams.push({
      canvas: this.name,
      frameRate,
      width: this.width,
      height: this.height,
    })
    return new FakeMediaStream(this.smoke)
  }
}

class FakeAnchorElement {
  constructor(smoke) {
    this.smoke = smoke
    this.href = ''
    this.download = ''
  }

  click() {
    this.smoke.downloads.push({
      download: this.download,
      href: this.href,
    })
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(smoke, name) {
    super()
    this.smoke = smoke
    this.name = name
    this.canvas = null
    this.iframes = []
    this.createdCanvases = 0
    this.documentElement = new FakeElement('', smoke, 'HTML')
    this.body = new FakeElement('', smoke, 'BODY')
  }

  getElementById(id) {
    return id === 'entryCanvas' ? this.canvas : null
  }

  querySelectorAll(selector) {
    return selector === 'iframe' ? this.iframes : []
  }

  createElement(tagName) {
    if (tagName === 'canvas') {
      this.createdCanvases += 1
      return new FakeHTMLCanvasElement(this.smoke, `${this.name}-created-canvas-${this.createdCanvases}`)
    }

    if (tagName === 'a') {
      return new FakeAnchorElement(this.smoke)
    }

    return new FakeElement('', this.smoke, tagName.toUpperCase())
  }
}

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms))
}

async function waitForSmokeCompletion(smoke, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (smoke.downloads.length || smoke.alerts.length || smoke.errors.length) return
    await wait(10)
  }
}

function createRaf(smoke) {
  let nextId = 1
  const timers = new Map()

  return {
    requestAnimationFrame(callback) {
      const id = nextId++
      const timer = setTimeout(() => {
        timers.delete(id)
        smoke.rafCalls += 1
        callback(Date.now())
      }, 35)
      timers.set(id, timer)
      return id
    },
    cancelAnimationFrame(id) {
      const timer = timers.get(id)
      if (timer) clearTimeout(timer)
      timers.delete(id)
    },
  }
}

function createDisplayObject() {
  return {
    children: [],
    on() {},
    removeAllListeners() {},
    removeAllEventListeners() {},
  }
}

function installEntryRuntime(win, doc, smoke, { webgl, renderHook = true, stopMode = 'entry-event' }) {
  const sourceCanvas = new FakeHTMLCanvasElement(smoke, `${doc.name}-entryCanvas`)
  doc.canvas = sourceCanvas

  let runState = 'stop'
  let tick = 0
  const listeners = new Map()
  const entity = {
    id: 'entity-1',
    parent: {
      id: 'object-1',
      getName: () => 'Smoke Sprite',
      getLock: () => false,
    },
  }

  function addEntryListener(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(callback)
  }

  function dispatchEntryEvent(event) {
    listeners.get(event)?.forEach(callback => callback())
  }

  function Scope(block) {
    this.block = block
  }

  Scope.prototype.run = function run(entityArg) {
    smoke.scopeRuns.push({
      blockType: this.block?.type,
      entityId: entityArg?.id,
    })
  }

  const stageCanvas = {
    canvas: sourceCanvas,
    children: [createDisplayObject()],
    x: 240,
    y: 135,
    scaleX: 1,
    scaleY: 1,
    update() {
      smoke.stageCanvasUpdates += 1
    },
  }

  const app = {
    screen: { width: sourceCanvas.width, height: sourceCanvas.height },
    renderer: {
      options: {
        width: sourceCanvas.width,
        height: sourceCanvas.height,
      },
      resize(width, height) {
        smoke.rendererResizes.push({ width, height })
      },
    },
  }

  if (renderHook) {
    app.render = () => {
      smoke.renderCalls += 1
    }
  }

  win.Entry = {
    Scope,
    Lang: {
      Blocks: {
        move_direction: 'move %1 steps',
      },
    },
    options: { useWebGL: webgl },
    type: 'workspace',
    requestUpdate: false,
    engine: {
      isState(state) {
        return runState === state
      },
      toggleRun() {
        runState = 'run'

        function step() {
          if (runState !== 'run') return
          tick += 1
          new Scope({
            id: `block-${tick}`,
            type: 'move_direction',
            params: [tick],
          }).run(entity, false)
          if (typeof app.render === 'function') app.render()

          if (tick < 4) {
            win.requestAnimationFrame(step)
          } else {
            runState = 'stop'
            win.setTimeout(() => {
              if (stopMode === 'entry-event') {
                dispatchEntryEvent('stop')
              } else {
                doc.dispatchEvent(new FakeEvent('click', {
                  target: new FakeElement('entryEngineButtonMinimize entryStopButtonMinimize'),
                }))
              }
            }, 0)
          }
        }

        win.requestAnimationFrame(step)
      },
    },
    stage: {
      canvas: stageCanvas,
      _app: app,
      inputField: null,
      variableContainer: { children: [] },
      handle: {
        getEventCoordinate(event) {
          return event
        },
      },
      isObjectClick: false,
      isEntitySelectable: () => false,
      updateObject() {},
      update() {},
    },
    container: {
      objects_: [],
      selectObject() {},
    },
    dispatchEvent() {},
    addEventListener: addEntryListener,
  }
}

function createWindow(smoke, name) {
  const doc = new FakeDocument(smoke, name)
  const raf = createRaf(smoke)
  const win = {
    document: doc,
    frames: [],
    HTMLCanvasElement: FakeHTMLCanvasElement,
    Element: FakeElement,
    MediaStream: FakeMediaStream,
    Blob,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
  }

  return { win, doc }
}

function createMediaRecorderClass(smoke) {
  return class FakeMediaRecorder extends FakeEventTarget {
    static isTypeSupported(type) {
      return type.includes('webm')
    }

    constructor(stream, options = {}) {
      super()
      this.stream = stream
      this.options = options
      this.mimeType = options.mimeType || 'video/webm'
      this.state = 'inactive'
      smoke.mediaRecorderOptions = options
      smoke.mediaRecorderTrackCount = stream.getTracks().length
    }

    start() {
      this.state = 'recording'
      smoke.recorderStarted = true
    }

    stop() {
      smoke.mediaRecorderStopCalls += 1
      if (this.state === 'inactive') return
      this.state = 'inactive'
      smoke.recorderStopped = true
      this.dispatchEvent(new FakeEvent('dataavailable', {
        data: new Blob(['entry-recorder-smoke'], { type: this.mimeType }),
      }))
      this.dispatchEvent(new FakeEvent('stop'))
    }
  }
}

async function runSmokeCase({
  iframe,
  webgl,
  renderHook = true,
  stopMode = 'entry-event',
  recordMode = 'overlay',
}) {
  const smoke = {
    mode: { iframe, webgl, renderHook, stopMode, recordMode },
    alerts: [],
    captureStreams: [],
    downloads: [],
    drawImageCalls: [],
    errors: [],
    indicatorRemoved: 0,
    indicatorShown: 0,
    mediaRecorderOptions: null,
    mediaRecorderStopCalls: 0,
    mediaRecorderTrackCount: 0,
    objectUrls: [],
    rafCalls: 0,
    recorderStarted: false,
    recorderStopped: false,
    rendererResizes: [],
    renderCalls: 0,
    scopeRuns: [],
    stageCanvasUpdates: 0,
    textDraws: [],
    trackStopCalls: 0,
    trackStops: 0,
  }

  const top = createWindow(smoke, 'top')
  let runtimeWindow = top.win
  let runtimeDocument = top.doc

  if (iframe) {
    const child = createWindow(smoke, 'iframe')
    top.win.frames.push(child.win)
    top.doc.iframes.push({ contentWindow: child.win })
    runtimeWindow = child.win
    runtimeDocument = child.doc
  }

  installEntryRuntime(runtimeWindow, runtimeDocument, smoke, { webgl, renderHook, stopMode })

  const MediaRecorder = createMediaRecorderClass(smoke)
  const context = {
    window: top.win,
    document: top.doc,
    console: {
      log() {},
      warn(...args) {
        smoke.errors.push(`warn: ${args.join(' ')}`)
      },
      error(...args) {
        smoke.errors.push(`error: ${args.join(' ')}`)
      },
    },
    alert(message) {
      smoke.alerts.push(String(message))
    },
    MediaRecorder,
    MediaStream: FakeMediaStream,
    MediaStreamAudioDestinationNode: class {},
    HTMLCanvasElement: FakeHTMLCanvasElement,
    HTMLAnchorElement: FakeAnchorElement,
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = `blob:smoke-${smoke.objectUrls.length + 1}`
        smoke.objectUrls.push({ url, type: blob.type, size: blob.size })
        return url
      },
      revokeObjectURL() {},
    },
    performance: {
      now: () => Date.now(),
    },
    requestAnimationFrame: top.win.requestAnimationFrame,
    cancelAnimationFrame: top.win.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    devicePixelRatio: 1,
  }

  top.win.window = top.win
  top.win.createjs = {}
  top.win.MediaRecorder = MediaRecorder
  top.win.MediaStream = FakeMediaStream
  top.win.Blob = Blob
  top.win.__ENTRY_RECORDER_REQUEST__ = { mode: recordMode }

  if (iframe) {
    runtimeWindow.window = runtimeWindow
    runtimeWindow.createjs = {}
    runtimeWindow.MediaRecorder = MediaRecorder
    runtimeWindow.MediaStream = FakeMediaStream
    runtimeWindow.Blob = Blob
  }

  vm.createContext(context)
  vm.runInContext(bundleSource, context, {
    filename: bundlePath,
    timeout: 1000,
  })

  await waitForSmokeCompletion(smoke)

  const compositeDraws = smoke.drawImageCalls.filter(call => call.target.includes('created-canvas')).length
  const sourceCanvasDraws = smoke.drawImageCalls.filter(call => call.source.includes('entryCanvas')).length
  const overlayTexts = smoke.textDraws.filter(text => text.includes('move') || text.includes('Entry') || text.includes('code'))
  const modeDrawsExpectedBackground = recordMode !== 'fullscreen-code'

  return {
    ...smoke,
    compositeDraws,
    sourceCanvasDraws,
    overlayTexts,
    pass:
      smoke.alerts.length === 0 &&
      smoke.errors.length === 0 &&
      smoke.recorderStarted &&
      smoke.recorderStopped &&
      smoke.downloads.length === 1 &&
      smoke.indicatorRemoved === 1 &&
      smoke.indicatorShown === 1 &&
      smoke.captureStreams.length === 1 &&
      smoke.scopeRuns.length >= 1 &&
      compositeDraws >= 1 &&
      (modeDrawsExpectedBackground ? sourceCanvasDraws >= 1 : sourceCanvasDraws === 0) &&
      overlayTexts.some(text => text.includes('move')),
  }
}

const cases = [
  { iframe: false, webgl: false },
  { iframe: false, webgl: true },
  { iframe: true, webgl: false },
  { iframe: true, webgl: true },
  { iframe: false, webgl: true, renderHook: false },
  { iframe: true, webgl: true, renderHook: false },
  { iframe: false, webgl: true, stopMode: 'button-click' },
  { iframe: true, webgl: true, stopMode: 'button-click' },
  { iframe: false, webgl: true, recordMode: 'fullscreen-code' },
  { iframe: true, webgl: true, recordMode: 'fullscreen-code' },
  { iframe: false, webgl: true, recordMode: 'fullscreen-code-over-project' },
  { iframe: true, webgl: true, recordMode: 'fullscreen-code-over-project' },
]

const results = []
for (const testCase of cases) {
  results.push(await runSmokeCase(testCase))
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  for (const result of results) {
    const mode = [
      result.mode.iframe ? 'iframe' : 'top',
      result.mode.webgl ? 'webgl' : '2d',
      result.mode.renderHook ? 'render-hook' : 'raf-fallback',
      result.mode.stopMode,
      result.mode.recordMode,
    ].join('/')
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${mode}`)
  }
}

const failures = results.filter(result => !result.pass)
if (failures.length) {
  console.error(`Entry Recorder smoke failed: ${failures.length}/${results.length}`)
  process.exitCode = 1
}
