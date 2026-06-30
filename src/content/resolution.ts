declare global {
  namespace Entry {
    interface Stage {
      updateObject(): void
      isEntitySelectable(): boolean
      update(): void
      handle: Handle
      variableContainer: {
        children: StageObject[]
      }
      isObjectClick: boolean
      inputField: InputField | null
      canvas: {
        update?(): void
        children: StageObject[]
        x: number
        y: number
        scaleX: number
        scaleY: number
        canvas: HTMLCanvasElement
      }
      _app: {
        render?(): void
        screen?: Resizable
        renderer?: {
          resize(width: number, height: number): void
          options: Resizable
        }
      }
    }
    
    interface InputField {
      _isHidden: boolean
      _x: number
      _y: number
      _padding: number
      getPixiView(): {
        scale: Settable
        position: Settable
      }
      x(data: number): void
      y(data: number): void
      width(data: number): void
      height(data: number): void
      padding(data: number): void
      borderWidth(data: number): void
      borderRadius(data: number): void
      fontSize(data: number): void
    }
    
    interface Settable {
      x: number
      y: number
      set(x?: number, y?: number): this
    }
    
    interface Resizable {
      width: number
      height: number
    }
    
    interface EntryObject {
      id: string
      getLock(): boolean
    }
    
    interface Entity {
      x: number
      y: number
      setX(data: number): void
      setY(data: number): void
      initCommand(): void
      parent: EntryObject
    }
    
    interface StageEvent {
      stageX: number
      stageY: number
    }
    
    export interface StageObject {
      offsetX: number
      offsetY: number
      variable: {
        getWidth(): number
        getHeight(): number
        setWidth(data: number): void
        setHeight(data: number): void
        getX(): number
        setSlideCommandX(x: number): void
        isResizing?: boolean
        isAdjusting?: boolean
        slideBar_?: StageObject
        valueSetter_?: StageObject
        resizeHandle_?: StageObject
        scrollButton_?: StageObject
        setX(data: number): void
        setY(data: number): void
        updateView(): void
      }
      x: number
      y: number
      cursor: string
      children: StageObject[]
      resolution?: number
      parent: {
        x: number
        y: number
        cursor: string
      }
      offset: {
        x: number
        y: number
      }
      on(event: string, handler: (event: StageEvent) => void): void
      removeAllListeners?(event: string): void
      removeAllEventListeners?(event: string): void
      entity: Entity
      _viewportPatched?: number
      _events?: {
        [k: string]: {
          fn(event: StageEvent): void
        }
      }
    }
    
    interface Handle {
      getEventCoordinate(event: StageEvent): {
        x: number
        y: number
      }
    }

    export namespace engine {
      export function toggleRun(): void
      export function isState(state: string): boolean
    }

    export function dispatchEvent(event: string, object: Entity): void
    export function addEventListener(event: string, callback: () => void): void
    export namespace options {
      export const useWebGL: boolean
    }

    export let requestUpdate: boolean
    export namespace container {
      export function selectObject(id: string): void
      export const objects_: {
        entity: {
          object: StageObject
        }
      }[]
    }

    export const type: string
    export const stage: Stage | undefined
  }
}

export function changeResolution(entry: typeof Entry, width: number, height: number) {
  const stage = entry?.stage
  if (!stage) return

  const entryAny = entry as any
  const stageAny = stage as any
  const type = entryAny.type
  const engine = entryAny.engine
  const useWebGL = !!entryAny.options?.useWebGL
  const canvas = stageAny.canvas
  const canvasElement = canvas?.canvas
  if (!canvas || !canvasElement) return

  const canvasChildren: any[] = Array.isArray(canvas.children) ? canvas.children : []
  if (useWebGL) for (const text of canvasChildren.flatMap(function findTree(v: any): any[] {
    const children = Array.isArray(v?.children) ? v.children : []
    return [v, ...children.flatMap(findTree)]
  }).filter((v: any) => v.resolution)) text.resolution = width / 640

  if (canvasElement.width != width || canvasElement.height != height) {
    canvasElement.width = width
    canvasElement.height = height
    canvas.x = width / 2
    canvas.y = height / 2
    canvas.scaleX = width / 480
    canvas.scaleY = height / 270

    const app = stageAny._app
    const { screen, renderer } = app || {}
    if (screen && renderer) {
      screen.width = width
      screen.height = height
      renderer.resize(width, height)
      renderer.options.width = width
      renderer.options.height = height
    }

    app?.render?.()
    canvas.update?.()
  }

  const inputField = stageAny.inputField
  if (inputField && !inputField._isHidden && inputField._padding != width * 13 / 640) {
    inputField.x(Math.round(width * 3 / 128))
    inputField.y(Math.round(height * 55 / 72))
    inputField.width(Math.max(1, width * 13 / 16))
    inputField.height(Math.max(1, height / 15))
    inputField.padding(width * 13 / 640)
    inputField.borderWidth(width / 320)
    inputField.borderRadius(width / 64)
    inputField.fontSize(width / 32)

    if (useWebGL) {
      const view = inputField.getPixiView()
      view.scale.set(480 / width, 270 / height)
      view.position.set((inputField._x - canvas.x) / canvas.scaleX, (inputField._y - canvas.y) / canvas.scaleY)
    }
    entry.requestUpdate = true
    stageAny.update?.()
    entry.requestUpdate = false
  }

  const objects: any[] = entryAny.container?.objects_ || []
  objects.forEach((item: any, i: number) => {
    const object = item?.entity?.object
    if (!object) return

    if (object._viewportPatched == i) return
    object._viewportPatched = i
    object.removeAllListeners?.('__pointermove')
    object.removeAllListeners?.('__pointerup')
    object.removeAllEventListeners?.('mousedown')
    object.removeAllEventListeners?.('pressmove')
    object.on(useWebGL ? '__pointermove' : 'mousedown', ({ stageX, stageY }: Entry.StageEvent) => {
      entry.dispatchEvent?.('entityClick', object.entity)
      stage.isObjectClick = true
      if (entry.type != 'minimize' && stage.isEntitySelectable()) {
        object.offset = {
          x: -object.parent.x + object.entity.x - ((stageX - canvas.x) / canvas.scaleX),
          y: -object.parent.y - object.entity.y - ((stageY - canvas.y) / canvas.scaleY),
        }
        object.cursor = 'move'
        object.entity.initCommand()
        entryAny.container?.selectObject?.(object.entity.parent.id)
      }
    })
    object.on(useWebGL ? '__pointerup' : 'pressmove', ({ stageX, stageY }: Entry.StageEvent) => {
      if (!stage.isEntitySelectable()) return
      const { entity } = object
      if (entity.parent.getLock()) return
      if (object.offset) {
        entity.setX((stageX - canvas.x) / canvas.scaleX + object.offset.x)
        entity.setY((canvas.y - stageY) / canvas.scaleY - object.offset.y)
      }
      stageAny.updateObject?.()
    })
  })
  const variables: any[] = stageAny.variableContainer?.children || []
  variables.forEach((variable: any, i: number) => {
    const { variable: variableObj } = variable
    if (!variableObj) return

    const { slideBar_, valueSetter_, resizeHandle_, scrollButton_ } = variableObj
    if (slideBar_ && slideBar_._viewportPatched != i) {
      slideBar_._viewportPatched = i
      slideBar_.removeAllListeners?.('__pointermove')
      slideBar_.removeAllEventListeners?.('mousedown')
      slideBar_.on(useWebGL ? '__pointermove' : 'mousedown', ({ stageX }: Entry.StageEvent) => engine?.isState?.('run') && variableObj.setSlideCommandX(stageX / canvas.scaleX - variableObj.getX() - canvas.x / canvas.scaleX))
    }

    if (valueSetter_ && valueSetter_._viewportPatched != i) {
      valueSetter_._viewportPatched = i
      valueSetter_.removeAllListeners?.('__pointermove')
      valueSetter_.removeAllListeners?.('__pointerup')
      valueSetter_.removeAllEventListeners?.('mousedown')
      valueSetter_.removeAllEventListeners?.('pressmove')
      valueSetter_.on(useWebGL ? '__pointermove' : 'mousedown', ({ stageX }: Entry.StageEvent) => engine?.isState?.('run') && (
        variableObj.isAdjusting = true,
        valueSetter_.offsetX = stageX / canvas.scaleX - valueSetter_.x
      ))
      valueSetter_.on(useWebGL ? '__pointerup' : 'pressmove', ({ stageX }: Entry.StageEvent) => engine?.isState?.('run') && variableObj.setSlideCommandX(stageX / canvas.scaleX - valueSetter_.offsetX + 5))
    }

    if (resizeHandle_ && resizeHandle_._viewportPatched != i) {
      resizeHandle_._viewportPatched = i
      resizeHandle_.removeAllListeners?.('__pointermove')
      resizeHandle_.removeAllListeners?.('__pointerup')
      resizeHandle_.removeAllEventListeners?.('mousedown')
      resizeHandle_.removeAllEventListeners?.('pressmove')
      resizeHandle_.on(useWebGL ? '__pointermove' : 'mousedown', ({ stageX, stageY }: Entry.StageEvent) => {
        variableObj.isResizing = !0
        resizeHandle_.offset = {
          x: stageX / canvas.scaleX - variableObj.getWidth(),
          y: stageY / canvas.scaleY - variableObj.getHeight(),
        }
        resizeHandle_.parent.cursor = 'nwse-resize'
      })
      resizeHandle_.on(useWebGL ? '__pointerup' : 'pressmove', ({ stageX, stageY }: Entry.StageEvent) => {
        variableObj.setWidth(stageX / canvas.scaleX - resizeHandle_.offset.x)
        variableObj.setHeight(stageY / canvas.scaleY - resizeHandle_.offset.y)
        variableObj.updateView()
      })
    }

    if (scrollButton_ && scrollButton_._viewportPatched != i) {
      scrollButton_._viewportPatched = i
      scrollButton_.removeAllListeners?.('__pointermove')
      scrollButton_.removeAllListeners?.('__pointerup')
      scrollButton_.removeAllEventListeners?.('mousedown')
      scrollButton_.removeAllEventListeners?.('pressmove')
      scrollButton_.on(useWebGL ? '__pointermove' : 'mousedown', ({ stageY }: Entry.StageEvent) => {
        variableObj.isResizing = !0
        scrollButton_.offsetY = stageY - scrollButton_.y * canvas.scaleY
      })
      scrollButton_.on(useWebGL ? '__pointerup' : 'pressmove', ({ stageY }: Entry.StageEvent) => {
        scrollButton_.y = Math.max(25, Math.min(variableObj.getHeight() - 30, (stageY - scrollButton_.offsetY) / canvas.scaleY))
        variableObj.updateView()
      })
    }

    if (variable._viewportPatched != i) {
      variable._viewportPatched = i
      variable.removeAllListeners?.('__pointermove')
      variable.removeAllListeners?.('__pointerup')
      variable.removeAllEventListeners?.('mousedown')
      variable.removeAllEventListeners?.('pressmove')
      variable.on(useWebGL ? '__pointermove' : 'mousedown', ({ stageX, stageY }: Entry.StageEvent) => type == 'workspace' && (
        variable.offset = {
          x: variable.x - (stageX - canvas.x) / canvas.scaleX,
          y: variable.y - (stageY - canvas.y) / canvas.scaleY,
        }
      ))
      variable.on(useWebGL ? '__pointerup' : 'pressmove', ({ stageX, stageY }: Entry.StageEvent) => type != 'workspace' || variableObj.isResizing || variableObj.isAdjusting || (
        variableObj.setX((stageX - canvas.x) / canvas.scaleX + variable.offset.x),
        variableObj.setY((stageY - canvas.y) / canvas.scaleY + variable.offset.y),
        variableObj.updateView()
      ))
    }
  })
  if (stageAny.handle) {
    stageAny.handle.getEventCoordinate = ({ stageX, stageY }: Entry.StageEvent) => ({
      x: (stageX - canvas.x) / canvas.scaleX,
      y: (stageY - canvas.y) / canvas.scaleY,
    })
  }

  // Entry FHD 비활성화
  try {
    Object.defineProperties(canvasElement, {
      offsetWidth: {
        get() {
          return width / devicePixelRatio
        },
      },
      offsetHeight: {
        get() {
          return height / devicePixelRatio
        },
      },
    })
  } catch {}
}
