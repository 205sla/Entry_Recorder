import { changeResolution } from './resolution'

interface RecordOptions extends MediaRecorderOptions {
  frameRequestRate: number
}

const options: Partial<RecordOptions> = {
  mimeType: 'video/mp4;codecs="avc1.640032,mp4a.40.2"',
  videoBitsPerSecond: 16_000_000,
}

record: {
  function record(width: number, height: number) {
    if (!(canvas instanceof HTMLCanvasElement)) return
    changeResolution(Entry, width, height)

    const stream = canvas.captureStream(options?.frameRequestRate)
    const recorder = new MediaRecorder(stream, options)

    const destination = new MediaStreamAudioDestinationNode(createjs.WebAudioSoundInstance.context)
    createjs.WebAudioSoundInstance.destinationNode.connect(destination)
    destination.stream.getTracks().forEach(track => stream.addTrack(track))

    const parts: Blob[] = []
    recorder.addEventListener('dataavailable', ({ data }) => {
      if (!data.size) return
      parts.push(data)
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(new Blob(parts, { type: recorder.mimeType }))
      anchor.download = ''
      anchor.click()
      setTimeout(URL.revokeObjectURL, 0, anchor.href)
    })
    recorder.start()
    Entry.engine.toggleRun()
    Entry.addEventListener('stop', () => {
      recorder.stop()
    })
  }

  const iframe = self.document.querySelector('.eaizycc0')
  const document = iframe instanceof HTMLIFrameElement && iframe.contentDocument || self.document
  const createjs = iframe instanceof HTMLIFrameElement && (iframe.contentWindow as Window & typeof globalThis)?.createjs || self.createjs
  const Entry = iframe instanceof HTMLIFrameElement && (iframe.contentWindow as Window & typeof globalThis)?.Entry || self.Entry

  // 확장에 있는 생성자와 iframe에 있는 생성자는 다르다. 그러므로 일치해준다.
  const HTMLCanvasElement = iframe instanceof HTMLIFrameElement && (iframe.contentWindow as Window & typeof globalThis)?.HTMLCanvasElement || self.HTMLCanvasElement
  if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) (iframe.contentWindow as Window & typeof globalThis).Function = Function

  const canvas = document.getElementById('entryCanvas') || self.document.getElementById('entryCanvas')
  if (!(canvas instanceof HTMLCanvasElement)) {
    alert('엔트리 작품 페이지가 아닙니다.')
    break record
  }

  record(1280, 720)
  // const dialog = document.createElement('dialog')
  // dialog.style.width = '384px'
  // dialog.style.height = '288px'
  // dialog.style.border = '0'
  // dialog.style.borderRadius = '16px'
  // self.document.body.appendChild(dialog)

  // const h3 = document.createElement('h3')
  // h3.textContent = '녹화하기'
  // h3.style.textAlign = 'center'
  // h3.style.marginTop = '1rem'
  // h3.style.fontSize = '1.875rem'
  // dialog.appendChild(h3)

  // const form = document.createElement('form')
  // dialog.appendChild(form)

  // const dl = document.createElement('dl')
  // dl.style.padding = '1rem'
  // form.appendChild(dl)

  // const widthLabel = document.createElement('dt').appendChild(document.createElement('label'))
  // widthLabel.textContent = '동영상 너비'
  // widthLabel.style.fontSize = '1.125rem'
  // widthLabel.style.float = 'left'
  // widthLabel.style.marginRight = '8px'
  // form.appendChild(widthLabel.parentNode!)

  // const widthInput = document.createElement('input')
  // widthInput.type = 'number'
  // widthInput.placeholder = '너비'
  // form.appendChild(widthInput)

  // dialog.showModal()
}
