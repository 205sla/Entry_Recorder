export type BlockStackImageStatus = 'loading' | 'ready' | 'error'

export interface BlockStackImageSnapshot {
  key: string
  rootBlockId: string
  currentBlockId: string
  blockCount: number
  status: BlockStackImageStatus
  width: number
  height: number
  image: HTMLImageElement | null
  error?: string
}

export interface BlockStackImageCache {
  prepare(): Promise<void>
  request(block: any): BlockStackImageSnapshot | null
  get(key: string): BlockStackImageSnapshot | null
  dispose(): void
}

interface CacheEntry extends BlockStackImageSnapshot {
  objectUrl?: string
  promise?: Promise<void>
}

interface SvgImageData {
  width: number
  height: number
  data: string
}

interface OffscreenCodeView {
  code: any
  board: any
  host: HTMLElement
}

const MAX_PREPARE_ROOTS = 12
const SVG_NS = 'http://www.w3.org/2000/svg'
const inlineImageCache = new Map<string, Promise<string | null>>()

function getBlockType(block: any) {
  return String(block?.type || block?.data?.type || '')
}

function getBlockId(block: any) {
  return String(block?.id || block?.id_ || block?.data?.id || getBlockType(block))
}

function getSvgId(element: any) {
  if (!element) return ''
  if (typeof element.getAttribute === 'function') return String(element.getAttribute('id') || '')
  return String(element.id || '')
}

function getView(block: any) {
  return block?.view || null
}

function getFirstBlock(thread: any) {
  if (!thread) return null

  try {
    if (typeof thread.getFirstBlock === 'function') return thread.getFirstBlock()
  } catch {}

  const blocks = getThreadBlocks(thread)
  return Array.isArray(blocks) ? blocks[0] : null
}

function getThreadBlocks(thread: any) {
  if (!thread) return []

  try {
    return toArray(typeof thread.getBlocks === 'function' ? thread.getBlocks() : thread.blocks || thread._data)
  } catch {
    return []
  }
}

function isEntryBlockLike(value: any) {
  return !!value && typeof value === 'object' && !!getBlockType(value)
}

function getRootBlock(block: any) {
  if (!isEntryBlockLike(block)) return null

  let current = block
  for (let guard = 0; guard < 50; guard += 1) {
    const thread = current?.thread
    const parent = thread?.parent

    if (isEntryBlockLike(parent)) {
      current = parent
      continue
    }

    return getFirstBlock(thread) || current
  }

  return current
}

function toArray(value: any): any[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value.toArray === 'function') {
    try {
      const result = value.toArray()
      return Array.isArray(result) ? result : []
    } catch {}
  }
  if (typeof value === 'object') return Object.values(value)
  return []
}

function getThreads(code: any) {
  if (!code) return []

  try {
    const threads = typeof code.getThreads === 'function' ? code.getThreads() : code.threads
    return toArray(threads)
  } catch {
    return []
  }
}

function getCodeFromObject(object: any) {
  return object?.script || object?.code || object?.object?.script || object?.entity?.script || object?.parent?.script
}

function getCodeFromBlock(block: any) {
  try {
    if (typeof block?.getCode === 'function') return block.getCode()
  } catch {}

  try {
    if (typeof block?.thread?.getCode === 'function') return block.thread.getCode()
  } catch {}

  return block?.thread?._code || null
}

function countBlockTree(block: any, seen = new Set<any>()): number {
  if (!isEntryBlockLike(block) || seen.has(block)) return 0
  seen.add(block)

  const statementCount = toArray(block?.statements).reduce((count, statement) => {
    if (typeof statement?.countBlock === 'function') {
      try {
        const value = Number(statement.countBlock())
        if (Number.isFinite(value) && value > 0) return count + value
      } catch {}
    }

    return count + getThreadBlocks(statement).reduce((sum, child) => sum + countBlockTree(child, seen), 0)
  }, 0)

  const paramCount = toArray(block?.params).reduce((count, param) => count + countBlockTree(param, seen), 0)

  return 1 + statementCount + paramCount
}

function countRootStackBlocks(rootBlock: any) {
  const thread = rootBlock?.thread

  if (typeof thread?.countBlock === 'function') {
    try {
      const value = Number(thread.countBlock())
      if (Number.isFinite(value) && value > 0) return value
    } catch {}
  }

  const blocks = getThreadBlocks(thread)
  const count = blocks.length
    ? blocks.reduce((sum, block) => sum + countBlockTree(block), 0)
    : countBlockTree(rootBlock)

  return Math.max(1, count || 1)
}

function collectCodeObjects(entry: any) {
  const container = entry?.container
  const objectSources = [
    container?.objects_,
    container?.objects,
    typeof container?.getAllObjects === 'function' ? container.getAllObjects() : null,
  ]
  const codes: any[] = []
  const seen = new Set<any>()

  objectSources.flatMap(toArray).forEach(object => {
    const code = getCodeFromObject(object)
    if (!code || seen.has(code) || !getThreads(code).length) return
    seen.add(code)
    codes.push(code)
  })

  return codes
}

function collectThreadsFromObject(object: any) {
  return getThreads(getCodeFromObject(object))
}

function collectRootBlocks(entry: any) {
  const roots: any[] = []
  const seen = new Set<string>()
  const container = entry?.container
  const objectSources = [
    container?.objects_,
    container?.objects,
    typeof container?.getAllObjects === 'function' ? container.getAllObjects() : null,
  ]

  objectSources.flatMap(toArray).forEach(object => {
    collectThreadsFromObject(object).forEach(thread => {
      const first = getFirstBlock(thread)
      const view = getView(first)
      const key = `${getBlockId(first)}:${getSvgId(view?.svgGroup)}`
      if (!first || !view?.svgGroup || seen.has(key)) return
      seen.add(key)
      roots.push(first)
    })
  })

  return roots
}

function findClonedElementById(root: Element, id: string) {
  if (!id) return null
  if (getSvgId(root) === id) return root

  const candidates = root.querySelectorAll('[id]')
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates.item(i)
    if (getSvgId(candidate) === id) return candidate
  }

  return null
}

function isOwnShapeElement(element: Element, target: Element) {
  let parent = element.parentElement
  while (parent && parent !== target) {
    if (getSvgId(parent)) return false
    parent = parent.parentElement
  }

  return parent === target
}

function getOwnShapeElements(target: Element) {
  const shapes = Array.from(target.querySelectorAll('path, rect, polygon')).filter(element =>
    isOwnShapeElement(element, target)
  )

  if (shapes.length) return shapes

  const fallback = target.querySelector('path, rect, polygon')
  return fallback ? [fallback] : []
}

function applyHighlight(svgGroup: Element, currentBlock: any) {
  const currentView = getView(currentBlock)
  const targetId = getSvgId(currentView?.svgGroup)
  const target = findClonedElementById(svgGroup, targetId)
  if (!target) return

  target.setAttribute('data-entry-recorder-current', 'true')
  getOwnShapeElements(target).forEach(shape => {
    shape.setAttribute('stroke', '#facc15')
    shape.setAttribute('stroke-width', '4')
    shape.setAttribute('stroke-linejoin', 'round')
    shape.setAttribute('vector-effect', 'non-scaling-stroke')
    shape.setAttribute('filter', 'url(#entry-recorder-block-highlight)')
  })
}

function cloneDefs(runtimeWindow: any, rootView: any) {
  const ownerDocument = rootView?.svgGroup?.ownerDocument || runtimeWindow.document || document
  const board = typeof rootView?.getBoard === 'function' ? rootView.getBoard() : null
  const fromJquery = board?.svgDom?.find?.('defs')
  const fromDom = board?.svgDom?.querySelector?.('defs') || rootView?.svgGroup?.ownerSVGElement?.querySelector?.('defs')
  const source = fromJquery?.[0] || fromJquery?.get?.(0) || fromDom
  const defs = source?.cloneNode ? source.cloneNode(true) : ownerDocument.createElementNS(SVG_NS, 'defs')
  const filter = ownerDocument.createElementNS(SVG_NS, 'filter')
  const blur = ownerDocument.createElementNS(SVG_NS, 'feGaussianBlur')
  const merge = ownerDocument.createElementNS(SVG_NS, 'feMerge')
  const mergeGlow = ownerDocument.createElementNS(SVG_NS, 'feMergeNode')
  const mergeSource = ownerDocument.createElementNS(SVG_NS, 'feMergeNode')

  filter.setAttribute('id', 'entry-recorder-block-highlight')
  filter.setAttribute('x', '-20%')
  filter.setAttribute('y', '-20%')
  filter.setAttribute('width', '140%')
  filter.setAttribute('height', '140%')
  blur.setAttribute('stdDeviation', '2')
  blur.setAttribute('result', 'coloredBlur')
  mergeGlow.setAttribute('in', 'coloredBlur')
  mergeSource.setAttribute('in', 'SourceGraphic')

  merge.appendChild(mergeGlow)
  merge.appendChild(mergeSource)
  filter.appendChild(blur)
  filter.appendChild(merge)
  defs.appendChild(filter)

  return defs
}

function normalizeSvgText(svgGroup: Element, runtimeWindow: any) {
  const entryStatic = runtimeWindow.EntryStatic || (window as any).EntryStatic
  const fontFamily = entryStatic?.getDefaultFontFamily?.() || 'Nanum Gothic, Noto Sans KR, Arial, sans-serif'
  const boldTypes = ['≥', '≤']
  const notResizeTypes = ['≥', '≤', '-', '>', '<', '=', '+', 'x', '/']

  Array.from(svgGroup.getElementsByTagName('text')).forEach(text => {
    text.setAttribute('font-family', fontFamily)
    const content = text.textContent || ''
    const size = parseInt(text.getAttribute('font-size') || '', 10)
    if (boldTypes.includes(content)) text.setAttribute('font-weight', '500')
    if (notResizeTypes.includes(content) && Number.isFinite(size)) {
      text.setAttribute('font-size', `${size}px`)
    }
    text.setAttribute('alignment-baseline', 'auto')
  })
}

function normalizeImageHref(image: Element, runtimeWindow: any) {
  const href = image.getAttribute('href') || image.getAttribute('xlink:href')
  if (!href) return ''
  if (/^(data:|blob:|https?:|chrome-extension:)/i.test(href)) return href

  try {
    const normalized = new URL(href, runtimeWindow.location.href).href
    image.setAttribute('href', normalized)
    return normalized
  } catch {
    return href
  }
}

function blobToDataUrl(runtimeWindow: any, blob: Blob) {
  return new Promise<string | null>(resolve => {
    const Reader = runtimeWindow.FileReader || FileReader
    const reader = new Reader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

function fetchImageAsDataUrl(runtimeWindow: any, href: string) {
  if (inlineImageCache.has(href)) return inlineImageCache.get(href)!

  const promise = Promise.resolve()
    .then(async () => {
      if (!/^https?:/i.test(href)) return null

      const response = await (runtimeWindow.fetch || fetch)(href, {
        credentials: 'include',
      })
      if (!response.ok) return null

      return blobToDataUrl(runtimeWindow, await response.blob())
    })
    .catch(() => null)

  inlineImageCache.set(href, promise)
  return promise
}

async function inlineSvgImages(svgGroup: Element, runtimeWindow: any) {
  const images = Array.from(svgGroup.getElementsByTagName('image'))
  await Promise.all(images.map(async image => {
    const href = normalizeImageHref(image, runtimeWindow)
    if (!href || href.startsWith('data:') || href.startsWith('blob:')) return

    const dataUrl = await fetchImageAsDataUrl(runtimeWindow, href)
    if (!dataUrl) return
    image.setAttribute('href', dataUrl)
    image.setAttribute('xlink:href', dataUrl)
  }))
}

function getScaledGroupBox(rootView: any, scale: number) {
  try {
    rootView?._skeleton?.box?.(rootView)
  } catch {}

  const rect = rootView?.svgGroup?.getBoundingClientRect?.()
  const width = Number(rect?.width || rootView?.width || rootView?._width || 360)
  const height = Number(rect?.height || rootView?.height || rootView?._height || 120)
  const offset = 2 * scale

  return {
    width: Math.max(1, Math.ceil(width + offset)),
    height: Math.max(1, Math.ceil(height + offset)),
  }
}

async function createHighlightedSvgData(entry: any, runtimeWindow: any, rootBlock: any, currentBlock: any): Promise<SvgImageData> {
  const rootView = getView(rootBlock)
  if (!rootView?.svgGroup?.cloneNode) {
    throw new Error('Block view SVG is not available.')
  }

  const scale = Number(rootView.getBoard?.()?.scale || 1)
  const svgGroup = rootView.svgGroup.cloneNode(true) as Element
  const svgCommentGroup = rootView.svgCommentGroup?.cloneNode?.(true) as Element | undefined
  svgGroup.removeAttribute('opacity')
  svgGroup.setAttribute('class', 'block selected')
  svgGroup.setAttribute('transform', `scale(${scale}) translate(0,0)`)
  svgCommentGroup?.setAttribute('transform', `scale(${scale}) translate(0,0)`)

  normalizeSvgText(svgGroup, runtimeWindow)
  await inlineSvgImages(svgGroup, runtimeWindow)
  applyHighlight(svgGroup, currentBlock)

  const serializer = new (runtimeWindow.XMLSerializer || XMLSerializer)()
  const defs = cloneDefs(runtimeWindow, rootView)
  const box = getScaledGroupBox(rootView, scale)
  const groups = [
    serializer.serializeToString(svgGroup),
    svgCommentGroup ? serializer.serializeToString(svgCommentGroup) : '',
  ].join('')

  let data = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<svg version="1.1" xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${box.width} ${box.height}" width="${box.width}" height="${box.height}">`,
    groups,
    serializer.serializeToString(defs),
    '</svg>',
  ].join('')

  if (entry?.isOffline) {
    const encoded = runtimeWindow.btoa(unescape(encodeURIComponent(data)))
    data = `data:image/svg+xml;base64,${encoded}`
  }

  data = data.replace(/>\s+/g, '>').replace(/\s+</g, '<').replace(/NS\d+:href/gi, 'href')
  return {
    width: box.width,
    height: box.height,
    data,
  }
}

function loadSvgImage(runtimeWindow: any, imageData: SvgImageData): Promise<{ image: HTMLImageElement; objectUrl?: string }> {
  return new Promise((resolve, reject) => {
    const image = runtimeWindow.document?.createElement?.('img') || new runtimeWindow.Image()
    let objectUrl: string | undefined

    image.onload = () => resolve({ image, objectUrl })
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      reject(new Error('Block SVG image could not be loaded.'))
    }

    if ('decoding' in image) image.decoding = 'async'
    image.width = imageData.width
    image.height = imageData.height

    if (imageData.data.startsWith('data:image/')) {
      image.src = imageData.data
      return
    }

    const blob = new Blob([imageData.data], { type: 'image/svg+xml;charset=utf-8' })
    objectUrl = URL.createObjectURL(blob)
    image.src = objectUrl
  })
}

export function createBlockStackImageCache(runtimeWindow: any, entry: any): BlockStackImageCache {
  const cache = new Map<string, CacheEntry>()
  const offscreenViews: OffscreenCodeView[] = []
  const offscreenCodeMap = new WeakMap<object, OffscreenCodeView>()

  function ensureCodeView(code: any) {
    if (!code || typeof code !== 'object') return false
    if (code.view) return true
    if (offscreenCodeMap.has(code)) return true
    if (!entry?.Board || !runtimeWindow.document?.createElement) return false

    const host = runtimeWindow.document.createElement('div') as HTMLElement
    host.id = `entry-recorder-block-image-board-${offscreenViews.length + 1}`
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = [
      'position:fixed',
      'left:-10000px',
      'top:-10000px',
      'width:1400px',
      'height:1000px',
      'opacity:0',
      'overflow:hidden',
      'pointer-events:none',
      'z-index:-1',
    ].join(';')

    const parent = runtimeWindow.document.body || runtimeWindow.document.documentElement
    parent.appendChild(host)

    try {
      const board = new entry.Board({ dom: host })
      if (typeof board.changeCode === 'function') {
        board.changeCode(code)
      } else if (typeof code.createView === 'function') {
        code.createView(board)
      }

      if (!code.view) {
        host.remove()
        return false
      }

      const offscreenView = { code, board, host }
      offscreenViews.push(offscreenView)
      offscreenCodeMap.set(code, offscreenView)
      return true
    } catch (error) {
      host.remove()
      console.warn('[Entry Recorder] hidden block view could not be created.', error)
      return false
    }
  }

  function ensurePreparedViews() {
    collectCodeObjects(entry).forEach(code => {
      ensureCodeView(code)
    })
  }

  function getKey(rootBlock: any, currentBlock: any) {
    const rootView = getView(rootBlock)
    const currentView = getView(currentBlock)
    return [
      getBlockId(rootBlock),
      getSvgId(rootView?.svgGroup),
      getBlockId(currentBlock),
      getSvgId(currentView?.svgGroup),
    ].join(':')
  }

  function createEntry(rootBlock: any, currentBlock: any): CacheEntry {
    const key = getKey(rootBlock, currentBlock)
    const entryData: CacheEntry = {
      key,
      rootBlockId: getBlockId(rootBlock),
      currentBlockId: getBlockId(currentBlock),
      blockCount: countRootStackBlocks(rootBlock),
      status: 'loading',
      width: 1,
      height: 1,
      image: null,
    }

    entryData.promise = Promise.resolve()
      .then(() => createHighlightedSvgData(entry, runtimeWindow, rootBlock, currentBlock))
      .then(async svgData => {
        const loaded = await loadSvgImage(runtimeWindow, svgData)
        entryData.status = 'ready'
        entryData.width = svgData.width
        entryData.height = svgData.height
        entryData.image = loaded.image
        entryData.objectUrl = loaded.objectUrl
      })
      .catch(error => {
        entryData.status = 'error'
        entryData.error = error instanceof Error ? error.message : String(error)
      })

    return entryData
  }

  function request(block: any): BlockStackImageSnapshot | null {
    ensureCodeView(getCodeFromBlock(block))

    const rootBlock = getRootBlock(block)
    const rootView = getView(rootBlock)
    const currentView = getView(block)
    if (!rootBlock || !rootView?.svgGroup || !currentView?.svgGroup) return null

    const key = getKey(rootBlock, block)
    let entryData = cache.get(key)
    if (!entryData) {
      entryData = createEntry(rootBlock, block)
      cache.set(key, entryData)
    }

    return entryData
  }

  return {
    async prepare() {
      ensurePreparedViews()

      const roots = collectRootBlocks(entry).slice(0, MAX_PREPARE_ROOTS)
      const promises = roots
        .map(root => {
          const snapshot = request(root)
          return snapshot ? cache.get(snapshot.key)?.promise : null
        })
        .filter((promise): promise is Promise<void> => !!promise)

      await Promise.allSettled(promises)
    },
    request,
    get(key: string) {
      return cache.get(key) || null
    },
    dispose() {
      cache.forEach(entryData => {
        if (entryData.objectUrl) URL.revokeObjectURL(entryData.objectUrl)
      })
      cache.clear()
      offscreenViews.forEach(({ code, board, host }) => {
        try {
          if (code?.board === board && typeof code.destroyView === 'function') {
            code.destroyView()
          }
        } catch {}
        host.remove()
      })
      offscreenViews.length = 0
    },
  }
}
