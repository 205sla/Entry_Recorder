export interface RunningBlockEvent {
  time: number
  objectId: string
  objectName: string
  blockId: string
  blockType: string
  label: string
  isClone: boolean
}

export interface RuntimeTraceSnapshot {
  current: RunningBlockEvent | null
  recent: RunningBlockEvent[]
}

interface TraceRegistry {
  listeners: Set<(scope: any, entity: any) => void>
  originalRun: Function
}

const REGISTRY_KEY = '__entryRecorderTraceRegistry'
const MAX_RECENT = 5
const DUPLICATE_INTERVAL_MS = 120

function getBlockType(block: any) {
  return String(block?.type || block?.data?.type || '')
}

function getBlockId(block: any) {
  return String(block?.id || block?.id_ || block?.data?.id || getBlockType(block))
}

function getObjectId(entity: any) {
  return String(entity?.id || entity?.id_ || entity?.parent?.id || entity?.parent?.id_ || '')
}

function getObjectName(entity: any) {
  const parent = entity?.parent

  if (parent && typeof parent.getName === 'function') {
    try {
      const name = parent.getName()
      if (name) return String(name)
    } catch {}
  }

  return String(
    parent?.name ||
    parent?.name_ ||
    parent?.objectName ||
    entity?.name ||
    entity?.name_ ||
    getObjectId(entity) ||
    '오브젝트'
  )
}

function getParamText(param: any): string {
  if (param === null || param === undefined) return ''
  if (typeof param === 'string' || typeof param === 'number' || typeof param === 'boolean') {
    return String(param)
  }
  if (param.type && Array.isArray(param.params)) {
    return param.params.map(getParamText).join(' ')
  }
  if (param.type) return String(param.type)
  return ''
}

function getLangBlocks(entry: any) {
  return (window as any).Lang?.Blocks || entry?.Lang?.Blocks || null
}

function formatLabel(entry: any, block: any) {
  const type = getBlockType(block)
  const langBlocks = getLangBlocks(entry)
  const template = langBlocks?.[type]
  const params = Array.isArray(block?.params) ? block.params.map(getParamText) : []

  if (typeof template === 'string' && template.trim()) {
    return template
      .replace(/%(\d+)/g, (_match, index) => params[Number(index) - 1] || '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return params.length ? `${type} ${params.join(' ')}` : type || '실행 블록'
}

function createEvent(entry: any, scope: any, entity: any): RunningBlockEvent | null {
  const block = scope?.block
  const blockType = getBlockType(block)
  if (!block || !blockType) return null

  return {
    time: performance.now(),
    objectId: getObjectId(entity),
    objectName: getObjectName(entity),
    blockId: getBlockId(block),
    blockType,
    label: formatLabel(entry, block),
    isClone: !!entity?.isClone,
  }
}

function ensureTraceRegistry(entry: any): TraceRegistry | null {
  const Scope = entry?.Scope
  const prototype = Scope?.prototype
  if (!prototype || typeof prototype.run !== 'function') return null

  if (entry[REGISTRY_KEY]) return entry[REGISTRY_KEY]

  const registry: TraceRegistry = {
    listeners: new Set(),
    originalRun: prototype.run,
  }

  prototype.run = function patchedEntryRecorderRun(this: any, entity: any, isValue: boolean) {
    if (!isValue) {
      registry.listeners.forEach(listener => {
        try {
          listener(this, entity)
        } catch {}
      })
    }

    return registry.originalRun.apply(this, arguments)
  }

  entry[REGISTRY_KEY] = registry
  return registry
}

export function createRuntimeTracer(entry: any) {
  const registry = ensureTraceRegistry(entry)
  const recent: RunningBlockEvent[] = []
  let current: RunningBlockEvent | null = null
  let lastKey = ''
  let lastTime = 0

  const onRunBlock = (scope: any, entity: any) => {
    const event = createEvent(entry, scope, entity)
    if (!event) return

    const key = `${event.objectId}:${event.blockId}:${event.blockType}`
    if (key === lastKey && event.time - lastTime < DUPLICATE_INTERVAL_MS) return

    lastKey = key
    lastTime = event.time
    current = event
    recent.unshift(event)
    recent.splice(MAX_RECENT)
  }

  registry?.listeners.add(onRunBlock)

  return {
    getSnapshot(): RuntimeTraceSnapshot {
      return {
        current,
        recent: recent.slice(),
      }
    },
    dispose() {
      registry?.listeners.delete(onRunBlock)
    },
  }
}
