export type EntryRuntimeWindow = Window & typeof globalThis & {
  Entry?: typeof Entry
  createjs?: any
  __ENTRY_RECORDER_SESSION__?: {
    active: boolean
    stop(): void
  }
}

export interface EntryRuntime {
  window: EntryRuntimeWindow
  document: Document
  Entry: typeof Entry
  createjs: any
  canvas: HTMLCanvasElement
  HTMLCanvasElement: typeof HTMLCanvasElement
}

function canUseWindow(candidate: Window | null): candidate is EntryRuntimeWindow {
  if (!candidate) return false

  try {
    void candidate.document
    return true
  } catch {
    return false
  }
}

function collectCandidateWindows(): EntryRuntimeWindow[] {
  const result: EntryRuntimeWindow[] = []
  const seen = new Set<Window>()

  function add(candidate: Window | null) {
    if (!canUseWindow(candidate) || seen.has(candidate)) return
    seen.add(candidate)
    result.push(candidate)
  }

  add(window)

  document.querySelectorAll('iframe').forEach(iframe => {
    add(iframe.contentWindow)
  })

  for (let i = 0; i < window.frames.length; i++) {
    add(window.frames[i])
  }

  return result
}

function getCanvasFromDocument(document: Document, Canvas: typeof HTMLCanvasElement) {
  const canvas = document.getElementById('entryCanvas')
  return canvas instanceof Canvas ? canvas : null
}

function resolveRuntimeFromWindow(candidate: EntryRuntimeWindow): EntryRuntime | null {
  const Entry = candidate.Entry
  if (!Entry?.engine || !Entry.stage) return null

  const Canvas = candidate.HTMLCanvasElement || window.HTMLCanvasElement
  const canvas =
    getCanvasFromDocument(candidate.document, Canvas) ||
    getCanvasFromDocument(document, Canvas)

  if (!canvas) return null

  return {
    window: candidate,
    document: candidate.document,
    Entry,
    createjs: candidate.createjs || window.createjs,
    canvas,
    HTMLCanvasElement: Canvas,
  }
}

export function findEntryRuntime(): EntryRuntime | null {
  for (const candidate of collectCandidateWindows()) {
    const runtime = resolveRuntimeFromWindow(candidate)
    if (runtime) return runtime
  }

  return null
}

function hasRunnableScope(runtime: EntryRuntime) {
  const EntryWithScope = runtime.Entry as any
  return typeof EntryWithScope.Scope?.prototype?.run === 'function'
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitForEntryRuntime(timeoutMs = 8000, intervalMs = 100): Promise<EntryRuntime | null> {
  const deadline = performance.now() + timeoutMs

  while (performance.now() < deadline) {
    const runtime = findEntryRuntime()
    if (runtime && hasRunnableScope(runtime)) return runtime
    await delay(intervalMs)
  }

  const runtime = findEntryRuntime()
  return runtime && hasRunnableScope(runtime) ? runtime : null
}
