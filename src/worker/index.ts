export {}

type RecordingMode = 'overlay' | 'fullscreen-code'

const MENU_ROOT_ID = 'entryRecorder'
const START_OVERLAY_ID = 'startRecordOverlay'
const START_FULLSCREEN_CODE_ID = 'startRecordFullscreenCode'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ROOT_ID,
      title: 'Entry Recorder',
    })
    chrome.contextMenus.create({
      id: START_OVERLAY_ID,
      parentId: MENU_ROOT_ID,
      title: '녹화 시작하기 (작품+코드)',
    })
    chrome.contextMenus.create({
      id: START_FULLSCREEN_CODE_ID,
      parentId: MENU_ROOT_ID,
      title: '코드만 전체 화면 녹화',
    })
  })
})

function getRecordingMode(menuItemId: string | number): RecordingMode | null {
  if (menuItemId === START_OVERLAY_ID) return 'overlay'
  if (menuItemId === START_FULLSCREEN_CODE_ID) return 'fullscreen-code'
  return null
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = getRecordingMode(info.menuItemId)
  if (!mode) return
  if (!tab?.id) return

  const target = { tabId: tab.id }
  chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: (selectedMode: RecordingMode) => {
      ;(globalThis as any).__ENTRY_RECORDER_REQUEST__ = { mode: selectedMode }
    },
    args: [mode],
  }).then(() => chrome.scripting.executeScript({
    files: ['dist/content.js'],
    target,
    world: 'MAIN',
  })).catch(err => {
    console.error('[Entry Recorder] 스크립트 주입 실패', err)
  })
})
