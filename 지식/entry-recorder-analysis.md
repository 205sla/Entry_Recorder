# Entry Recorder 구조 분석과 코드 오버레이 개발 방향

분석일: 2026-06-30

## 기준

- 원본 저장소: https://github.com/idiotf/Entry_Recorder
- 사용자 fork: https://github.com/205sla/Entry_Recorder
- 분석 커밋: `83710fd01c72abeef6a25a1fbb451160d913a023`
- 로컬 경로: `C:\Users\young\prg\ENTRY\extensions\Entry Recorder`
- 확인 브랜치: `main`, `720p`

`720p` 브랜치는 `src/content/index.ts`의 녹화 해상도를 `2560x1440`에서 `1280x720`으로 낮추고 README를 삭제한 변형이다.

## 한 줄 요약

Entry Recorder는 엔트리 작품의 실행 캔버스와 SoundJS 오디오를 브라우저 안에서 녹화하는 MV3 확장이다. 현재 기능은 녹화에 집중되어 있고, 실행 중인 코드나 블록을 표시하는 기능은 아직 없다.

## 저장소 구조

```text
build/
  manifest.json
  dist/content.js
  dist/worker.js
src/
  worker/index.ts
  content/index.ts
  content/resolution.ts
package.json
webpack.config.js
```

- `build/manifest.json`: 배포용 MV3 manifest. `contextMenus`, `scripting`, `activeTab` 권한과 `https://playentry.org/*` host permission을 사용한다.
- `src/worker/index.ts`: 우클릭 메뉴 `녹화 시작하기`를 만들고, 클릭 시 `dist/content.js`를 `world: 'MAIN'`으로 주입한다.
- `src/content/index.ts`: Entry 런타임, canvas, createjs를 찾아 녹화를 시작한다.
- `src/content/resolution.ts`: 엔트리 stage/canvas 내부 크기와 좌표계를 원하는 녹화 해상도에 맞게 패치한다.

## 실행 흐름

1. 확장 서비스 워커가 컨텍스트 메뉴를 등록한다.
2. 사용자가 작품 페이지에서 `녹화 시작하기`를 클릭한다.
3. 확장이 현재 탭에 `dist/content.js`를 MAIN world로 주입한다.
4. content script가 `.eaizycc0` iframe을 찾고, 있으면 iframe 내부의 `Entry`, `createjs`, `HTMLCanvasElement`를 사용한다.
5. `entryCanvas`를 찾지 못하면 "엔트리 작품 페이지가 아닙니다." alert를 띄우고 종료한다.
6. `changeResolution(Entry, width, height)`로 엔트리 캔버스를 녹화 해상도로 바꾼다.
7. `canvas.captureStream()`으로 비디오 스트림을 만들고 `MediaRecorder`를 생성한다.
8. `createjs.WebAudioSoundInstance.destinationNode`를 `MediaStreamAudioDestinationNode`에 연결해 오디오 트랙을 비디오 스트림에 추가한다.
9. `recorder.start()` 후 `Entry.engine.toggleRun()`으로 작품을 실행한다.
10. Entry의 `stop` 이벤트가 오면 `recorder.stop()`을 호출한다.
11. `dataavailable` 이벤트에서 Blob URL을 만들고 다운로드 anchor를 클릭한다.

## 좋은 점

- 서버 없이 브라우저 내부 API만으로 녹화를 끝낸다.
- `canvas.captureStream()`을 사용하므로 실제 엔트리 실행 화면을 직접 녹화한다.
- SoundJS 오디오 출력까지 MediaStream에 합치는 접근이 좋다.
- MAIN world 주입을 사용하므로 `window.Entry`와 iframe 내부 런타임에 접근할 수 있다.
- 코드베이스가 작아서 실험과 포크 개발을 시작하기 쉽다.

## 주요 한계와 위험

- DOM 오버레이는 녹화되지 않는다. `canvas.captureStream()`은 캔버스 픽셀만 녹화하므로, 실행 중 코드 패널을 일반 DOM으로 띄워도 녹화 파일에는 들어가지 않는다.
- iframe 탐지가 `.eaizycc0` 클래스에 의존한다. 엔트리 사이트의 빌드 CSS 클래스가 바뀌면 깨질 수 있다.
- `MediaRecorder` MIME 타입이 `video/mp4;codecs="avc1.640032,mp4a.40.2"`로 고정되어 있다. `MediaRecorder.isTypeSupported()` 확인과 fallback이 필요하다.
- `Entry.engine.toggleRun()`은 현재 상태에 따라 실행이 아니라 정지가 될 수 있다. 녹화 시작 전 엔진 상태를 확인해야 한다.
- 녹화 중복 실행 방지가 없다. 사용자가 메뉴를 여러 번 누르면 오디오 연결, stop listener, recorder가 중복될 수 있다.
- `changeResolution()`이 Entry 내부 구조와 이벤트 리스너를 직접 패치하고 원상복구하지 않는다.
- `package.json` 버전은 `0.0.3`, `build/manifest.json` 버전은 `0.0.1`로 불일치한다.
- 다운로드 파일명이 비어 있다. 브라우저 기본 이름에 의존한다.
- Firefox 설정이 manifest에 있지만 구현은 Chrome MV3 `chrome.scripting.executeScript({ world: 'MAIN' })` 중심이다.

## 코드 오버레이 녹화에 필요한 추가 구조

실행 중인 코드를 영상에 넣는 방법은 두 갈래다.

### 1. OBS/화면 녹화용 DOM 오버레이

브라우저 화면 자체를 녹화한다면 DOM 오버레이가 가장 빠르다.

- Entry 실행 블록을 추적한다.
- 페이지 위에 고정 위치 패널을 만든다.
- 최근 실행 블록 또는 현재 실행 블록을 큰 글자로 표시한다.
- OBS, Xbox Game Bar, 브라우저 화면 녹화 등으로 화면 전체를 녹화한다.

이 방식은 구현이 빠르지만 Entry Recorder의 `canvas.captureStream()` 결과물에는 오버레이가 포함되지 않는다.

### 2. 확장 자체 녹화용 합성 캔버스

확장 프로그램이 바로 완성 영상을 다운로드해야 한다면 합성 캔버스가 필요하다.

```text
entryCanvas
  -> compositeCanvas에 drawImage()
  -> 현재 실행 블록/코드 패널을 compositeCanvas에 draw
  -> compositeCanvas.captureStream()
  -> createjs audio track 추가
  -> MediaRecorder
```

이 방식은 녹화 파일에 코드 표시가 포함된다. 대신 렌더 루프, 해상도, 자막 레이아웃, 성능 최적화를 추가로 설계해야 한다.

## 실행 블록 추적 후보

EntryJS 런타임 구조상 다음 지점을 사용할 수 있다.

- `Entry.dispatchEvent('blockExecute', view)` 이벤트 주변
- `Entry.Executor.prototype.execute`
- `Entry.Code.prototype.tick`
- 각 executor의 `executor.scope.block`

현재 EntryJS 흐름은 대략 다음과 같다.

```text
Entry.engine.update()
  -> Entry.container.mapObjectOnScene(this.computeFunction)
  -> script.tick()
  -> Entry.Code.executors
  -> executor.execute()
  -> executor.scope.block 실행
```

MVP에서는 `Entry.Executor.prototype.execute`를 감싸서 실행 직전의 `this.scope.block`을 읽는 방식이 가장 직접적이다. 실행 블록의 문구는 `Lang.Blocks`, block type, params를 조합해 만들 수 있다.

## 추천 개발 순서

1. 녹화 안정화
   - MIME fallback 추가
   - 중복 녹화 방지
   - 파일명 지정
   - 실행 전 엔진 상태 확인
   - stop listener 정리
   - 해상도 원상복구 전략 검토

2. 실행 블록 추적 모듈 추가
   - MAIN world에서 Entry 실행 이벤트 후킹
   - 최근 실행 블록 queue 유지
   - 오브젝트 이름, 블록 type, 표시 문구 수집
   - 반복 블록 과다 표시 방지를 위한 debounce/throttle

3. 녹화용 표시 방식 결정
   - OBS 전제: DOM 오버레이
   - 확장 자체 다운로드 전제: 합성 캔버스

4. 합성 캔버스 구현
   - 원본 Entry 캔버스를 프레임마다 복사
   - 우측/하단 코드 패널 렌더
   - 고정 해상도별 글자 크기와 줄바꿈 처리
   - `compositeCanvas.captureStream()`으로 교체

5. 실사이트 검증
   - `/project/<id>` iframe 작품보기
   - `/iframe/<id>` 직접 보기
   - `/noframe/<id>`
   - 소리 있는 작품
   - 여러 오브젝트/신호/복제본이 동시에 실행되는 작품

## 검증 기록

- 원본 `main` HEAD 확인: `83710fd01c72abeef6a25a1fbb451160d913a023`
- `720p` 브랜치 차이 확인: 녹화 해상도 `1280x720` 변경 및 README 삭제
- 임시 클론에서 `npm install --package-lock=false --ignore-scripts; npm run build` 성공
- 빌드 산출물은 webpack/minifier 버전 차이로 포맷만 달라질 수 있음
- 브라우저 실사이트 녹화 smoke test는 아직 수행하지 않음

## 다음 작업 메모

이 fork에서 코드 오버레이 녹화 기능을 구현한다면, 먼저 `src/content/index.ts`를 작게 나눠 `recorder`, `entry-runtime`, `overlay-tracer`, `compositor` 모듈로 분리하는 것이 좋다. 그 다음 DOM 오버레이 MVP로 실행 블록 추적 정확도를 확인하고, 마지막에 합성 캔버스 녹화로 확장하는 순서가 안전하다.

