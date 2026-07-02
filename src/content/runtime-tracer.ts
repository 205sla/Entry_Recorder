import type { BlockStackImageCache, BlockStackImageSnapshot } from './block-stack-image'

export interface RunningBlockToken {
  kind: 'text' | 'param'
  text: string
}

export interface RunningBlockEvent {
  time: number
  objectId: string
  objectName: string
  blockId: string
  blockType: string
  label: string
  tokens: RunningBlockToken[]
  blockClass: string
  color: string
  outerLine: string
  skeleton: string
  isClone: boolean
}

export interface RuntimeTraceSnapshot {
  current: RunningBlockEvent | null
  recent: RunningBlockEvent[]
  stackImage: BlockStackImageSnapshot | null
  stackImages: ActiveStackImage[]
}

interface TraceRegistry {
  listeners: Set<(scope: any, entity: any) => void>
  originalRun: Function
}

export interface ActiveStackImage {
  event: RunningBlockEvent
  stackImage: BlockStackImageSnapshot
}

interface ActiveStackState {
  event: RunningBlockEvent
  stackImageKey: string
  updatedAt: number
}

interface RuntimeTracerOptions {
  blockImages?: BlockStackImageCache
}

const REGISTRY_KEY = '__entryRecorderTraceRegistry'
const MAX_RECENT = 5
const DUPLICATE_INTERVAL_MS = 120
const ACTIVE_STACK_TTL_MS = 1200
const FALLBACK_COLORS = {
  START: { color: '#10D35E', outerLine: '#13BF68' },
  FLOW: { color: '#31C1EC', outerLine: '#08ACDD' },
  MOVING: { color: '#BF63FF', outerLine: '#B13EFE' },
  LOOKS: { color: '#FF5174', outerLine: '#EE3157' },
  BRUSH: { color: '#FC7E01', outerLine: '#FC5E01' },
  SOUND: { color: '#82D214', outerLine: '#6EBC02' },
  JUDGE: { color: '#7E8EFE', outerLine: '#1B3AD8' },
  CALC: { color: '#FEB71A', outerLine: '#FF9C00' },
  VARIABLE: { color: '#F57DF1', outerLine: '#EC52E7' },
  DEFAULT: { color: '#BF63FF', outerLine: '#B13EFE' },
}
const FALLBACK_TEMPLATES: Record<string, string> = {
  wait_second: '%1 초 기다리기',
  repeat_basic: '%1 번 반복하기',
  hidden_loop: '%1 번 반복하기',
  repeat_inf: '계속 반복하기',
  stop_repeat: '반복 중단하기',
  continue_repeat: '이번 반복 건너뛰기',
  wait_until_true: '%1 이(가) 될 때까지 기다리기',
  _if: '만일 %1 (이)라면',
  if_else: '만일 %1 (이)라면 아니면',
  create_clone: '%1 의 복제본 만들기',
  delete_clone: '이 복제본 삭제하기',
  when_clone_start: '복제본이 처음 생성되었을 때',
  stop_object: '%1 코드 멈추기',
  restart_project: '처음부터 다시 실행하기',
  remove_all_clones: '모든 복제본 삭제하기',
  move_direction: '이동 방향으로 %1 만큼 움직이기',
  move_x: 'x 좌표를 %1 만큼 바꾸기',
  move_y: 'y 좌표를 %1 만큼 바꾸기',
  locate_xy_time: '%1 초 동안 x: %2 y: %3 위치로 이동하기',
  rotate_by_angle: '오브젝트를 %1 만큼 회전하기',
  rotate_by_angle_dropdown: '%1 만큼 회전하기',
  see_angle: '이동 방향을 %1 (으)로 정하기',
  see_direction: '%1 쪽 보기',
  locate_xy: 'x: %1 y: %2 위치로 이동하기',
  locate_x: 'x: %1 위치로 이동하기',
  locate_y: 'y: %1 위치로 이동하기',
  locate: '%1 위치로 이동하기',
  move_xy_time: '%1 초 동안 x: %2 y: %3 만큼 움직이기',
  rotate_by_angle_time: '오브젝트를 %1 초 동안 %2 만큼 회전하기',
  bounce_wall: '화면 끝에 닿으면 튕기기',
  see_angle_object: '%1 쪽 바라보기',
  rotate_absolute: '방향을 %1 (으)로 정하기',
  rotate_relative: '방향을 %1 만큼 회전하기',
  direction_absolute: '이동 방향을 %1 (으)로 정하기',
  direction_relative: '이동 방향을 %1 만큼 회전하기',
  move_to_angle: '%1 방향으로 %2 만큼 움직이기',
}
const OPERATOR_TEXT: Record<string, string> = {
  EQUAL: '=',
  NOT_EQUAL: '!=',
  GREATER: '>',
  GREATER_OR_EQUAL: '>=',
  LESS: '<',
  LESS_OR_EQUAL: '<=',
}

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
    return OPERATOR_TEXT[String(param)] || String(param)
  }
  if (param.type && Array.isArray(param.params)) {
    const type = getBlockType(param)
    if (['number', 'text', 'string'].includes(type)) {
      return getParamText(param.params[0])
    }

    const values = param.params.map(getParamText).filter(Boolean)
    if (values.length && OPERATOR_TEXT[String(param.params[0])]) {
      return [OPERATOR_TEXT[String(param.params[0])], ...values.slice(1)].join(' ')
    }

    return values.join(' ')
  }
  if (param.type) return String(param.type)
  return ''
}

function getLangBlocks(entry: any, runtimeWindow: any) {
  return runtimeWindow?.Lang?.Blocks || (window as any).Lang?.Blocks || entry?.Lang?.Blocks || null
}

function getBlockSchema(entry: any, type: string) {
  return entry?.block?.[type] || null
}

function inferBlockClass(type: string, schema: any) {
  const blockClass = String(schema?.class || '')
  if (blockClass) return blockClass
  if (type.startsWith('when_') || type.includes('start') || type.includes('message')) return 'event'
  if (type.includes('repeat') || type.startsWith('if') || type.includes('wait') || type.includes('stop')) return 'flow'
  if (type.includes('move') || type.includes('rotate') || type.includes('direction') || type.includes('locate')) return 'walk'
  if (type.includes('sound')) return 'sound'
  if (type.includes('variable') || type.includes('list')) return 'variable'
  return ''
}

function getFallbackColor(blockClass: string, type: string) {
  if (blockClass === 'event' || type.startsWith('when_')) return FALLBACK_COLORS.START
  if (['repeat', 'flow', 'delay'].includes(blockClass) || type.includes('repeat') || type.includes('wait')) {
    return FALLBACK_COLORS.FLOW
  }
  if (['sound'].includes(blockClass) || type.includes('sound')) return FALLBACK_COLORS.SOUND
  if (['variable'].includes(blockClass) || type.includes('variable') || type.includes('list')) return FALLBACK_COLORS.VARIABLE
  if (['boolean', 'calc'].includes(blockClass)) return FALLBACK_COLORS.CALC
  if (type.includes('judge') || type.includes('boolean')) return FALLBACK_COLORS.JUDGE
  if (type.includes('show') || type.includes('hide') || type.includes('dialog') || type.includes('effect')) {
    return FALLBACK_COLORS.LOOKS
  }
  if (type.includes('brush') || type.includes('drawing') || type.includes('stamp')) return FALLBACK_COLORS.BRUSH
  if (['walk', 'rotate', 'moving'].includes(blockClass)) return FALLBACK_COLORS.MOVING
  return FALLBACK_COLORS.DEFAULT
}

function getBlockStyle(entry: any, type: string) {
  const schema = getBlockSchema(entry, type)
  const blockClass = inferBlockClass(type, schema)
  const fallback = getFallbackColor(blockClass, type)

  return {
    blockClass,
    color: typeof schema?.color === 'string' ? schema.color : fallback.color,
    outerLine: typeof schema?.outerLine === 'string' ? schema.outerLine : fallback.outerLine,
    skeleton: String(schema?.skeleton || (blockClass === 'event' ? 'basic_event' : 'basic')),
  }
}

function createLabelTokens(entry: any, block: any, runtimeWindow: any): RunningBlockToken[] {
  const type = getBlockType(block)
  const langBlocks = getLangBlocks(entry, runtimeWindow)
  const runtimeTemplate = langBlocks?.[type]
  const fallbackTemplate = FALLBACK_TEMPLATES[type]
  const template = fallbackTemplate && (typeof runtimeTemplate !== 'string' || !runtimeTemplate.includes('%'))
    ? fallbackTemplate
    : runtimeTemplate
  const params = Array.isArray(block?.params) ? block.params.map(getParamText) : []

  if (typeof template === 'string' && template.trim()) {
    const tokens: RunningBlockToken[] = []
    const pattern = /%(\d+)/g
    let cursor = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(template))) {
      const text = template.slice(cursor, match.index).replace(/\s+/g, ' ').trim()
      if (text) tokens.push({ kind: 'text', text })

      const param = params[Number(match[1]) - 1]
      if (param) tokens.push({ kind: 'param', text: param })
      cursor = match.index + match[0].length
    }

    const tail = template.slice(cursor).replace(/\s+/g, ' ').trim()
    if (tail) tokens.push({ kind: 'text', text: tail })
    if (tokens.length) return tokens
  }

  return [{ kind: 'text', text: params.length ? `${type} ${params.join(' ')}` : type || '실행 블록' }]
}

function formatLabel(tokens: RunningBlockToken[]) {
  return tokens.map(token => token.text).join(' ').replace(/\s+/g, ' ').trim()
}

function createEvent(
  entry: any,
  runtimeWindow: any,
  scope: any,
  entity: any,
  base: {
    blockId?: string
    blockType?: string
    objectId?: string
    time?: number
  } = {}
): RunningBlockEvent | null {
  const block = scope?.block
  const blockType = base.blockType || getBlockType(block)
  if (!block || !blockType) return null
  const tokens = createLabelTokens(entry, block, runtimeWindow)
  const style = getBlockStyle(entry, blockType)

  return {
    time: base.time ?? performance.now(),
    objectId: base.objectId || getObjectId(entity),
    objectName: getObjectName(entity),
    blockId: base.blockId || getBlockId(block),
    blockType,
    label: formatLabel(tokens),
    tokens,
    ...style,
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

export function createRuntimeTracer(entry: any, runtimeWindow: any = window, options: RuntimeTracerOptions = {}) {
  const registry = ensureTraceRegistry(entry)
  const recent: RunningBlockEvent[] = []
  const activeStacks = new Map<string, ActiveStackState>()
  let current: RunningBlockEvent | null = null
  let currentStackImageKey = ''
  let lastKey = ''
  let lastTime = 0

  function removeExpiredStacks(now: number) {
    activeStacks.forEach((stack, key) => {
      if (now - stack.updatedAt > ACTIVE_STACK_TTL_MS) {
        activeStacks.delete(key)
      }
    })
  }

  function getActiveStackImages(now: number): ActiveStackImage[] {
    removeExpiredStacks(now)

    return Array.from(activeStacks.values())
      .map(stack => {
        const stackImage = options.blockImages?.get(stack.stackImageKey)
        return stackImage ? { event: stack.event, stackImage } : null
      })
      .filter((stack): stack is ActiveStackImage => !!stack)
  }

  const onRunBlock = (scope: any, entity: any) => {
    const block = scope?.block
    const blockType = getBlockType(block)
    if (!block || !blockType) return

    const now = performance.now()
    const objectId = getObjectId(entity)
    const blockId = getBlockId(block)
    const key = `${objectId}:${blockId}:${blockType}`
    if (key === lastKey && now - lastTime < DUPLICATE_INTERVAL_MS) return

    lastKey = key
    lastTime = now
    const event = createEvent(entry, runtimeWindow, scope, entity, {
      blockId,
      blockType,
      objectId,
      time: now,
    })
    if (!event) return

    current = event
    const stackImage = options.blockImages?.request(scope?.block)
    currentStackImageKey = stackImage?.key || ''

    if (stackImage) {
      activeStacks.set(`${event.objectId}:${stackImage.rootBlockId}`, {
        event,
        stackImageKey: stackImage.key,
        updatedAt: event.time,
      })
      removeExpiredStacks(event.time)
    }

    recent.unshift(event)
    recent.splice(MAX_RECENT)
  }

  registry?.listeners.add(onRunBlock)

  return {
    getSnapshot(): RuntimeTraceSnapshot {
      return {
        current,
        recent: recent.slice(),
        stackImage: currentStackImageKey ? options.blockImages?.get(currentStackImageKey) || null : null,
        stackImages: getActiveStackImages(performance.now()),
      }
    },
    dispose() {
      registry?.listeners.delete(onRunBlock)
      activeStacks.clear()
    },
  }
}
