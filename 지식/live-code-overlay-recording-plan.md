# 실행 코드 오버레이 녹화 개발 기획서

작성일: 2026-06-30

## 기준 저장소

- Entry Recorder 원본: https://github.com/idiotf/Entry_Recorder
- Entry Recorder fork: https://github.com/205sla/Entry_Recorder
- BetterEntryScreen 원본: https://github.com/muno9748/BetterEntryScreen
- Entry Recorder 분석 커밋: `83710fd01c72abeef6a25a1fbb451160d913a023`
- BetterEntryScreen 분석 커밋: `76265ba7a553fbb8bb2c52751cf0a4950405c30a`
- 로컬 작업 경로: `C:\Users\young\prg\ENTRY\extensions\Entry Recorder`

## 목표

엔트리 작품을 유튜브 업로드용 영상으로 녹화할 때, 실행 화면 위에 "현재 실행 중인 블록/코드"를 함께 보여주는 브라우저 확장 프로그램을 만든다.

최종 사용 흐름은 다음과 같다.

1. 사용자가 엔트리 작품 페이지에서 확장 버튼 또는 우클릭 메뉴를 누른다.
2. 녹화 설정 패널에서 해상도, 오버레이 위치, 표시 모드를 고른다.
3. 녹화를 시작하면 작품이 실행되고, 현재 실행 중인 블록이 영상 안에 함께 표시된다.
4. 작품을 정지하거나 녹화 중지 버튼을 누르면 파일이 다운로드된다.

## 참고 구현에서 가져올 점

### Entry Recorder

Entry Recorder는 녹화 파이프라인의 기반으로 사용한다.

- MV3 확장 구조
- `chrome.contextMenus` 기반 시작 메뉴
- `chrome.scripting.executeScript({ world: 'MAIN' })` 주입
- `entryCanvas.captureStream()` 녹화
- SoundJS WebAudio 출력의 MediaStream 합성
- 고정 해상도 녹화 시도

현재 한계는 DOM 오버레이가 녹화되지 않는다는 점이다. 따라서 자체 다운로드 영상에 코드 표시를 넣으려면 원본 `entryCanvas`가 아니라 별도 합성 캔버스를 녹화해야 한다.

### BetterEntryScreen

BetterEntryScreen은 고해상도 렌더링과 좌표계 보정의 참고 구현으로 사용한다.

- `stage.canvas.canvas.width/height`, `stage.canvas.x/y`, `stage.canvas.scaleX/scaleY` 조정
- WebGL과 비-WebGL 분기 처리
- 화면 해상도 기준 16:9 렌더링 해상도 설정
- SVG 이미지의 원본 asset 재로딩 및 viewBox 기반 보정
- WebGL texture 교체와 scale factor 보정
- 변수/리스트 UI의 좌표 변환 보정
- clone entity 생성 시 이미지 보정 재적용

그대로 가져오기보다는 필요한 아이디어만 모듈화해 흡수한다. BetterEntryScreen은 직접 이벤트 리스너를 제거하고 Entry 내부 draw/setImage를 덮어쓰므로, 확장 배포용 구현에서는 원상복구와 중복 적용 방지가 필요하다.

## 제품 범위

### MVP

- 크롬/엣지 MV3 확장
- 작품 페이지에서 녹화 시작
- 엔트리 캔버스와 소리 녹화
- 현재 실행 블록 추적
- 영상 안에 현재 실행 블록 표시
- 720p, 1080p, 1440p 중 하나로 녹화
- 녹화 종료 시 WebM 또는 MP4 다운로드

### 1차 확장

- 최근 실행 블록 3~5개 타임라인 표시
- 오브젝트 이름 표시
- 함수 호출/신호/복제본 실행 구분
- 오버레이 위치 선택: 오른쪽, 왼쪽, 하단
- 글자 크기, 배경 투명도, 표시 유지 시간 설정
- 녹화 파일명 자동 생성

### 이후 후보

- 편집 화면 `/ws/`와 작품보기 `/project/`, `/iframe/`, `/noframe/` 공통 지원
- 녹화 전 카운트다운
- 녹화 중 일시정지
- 자막용 JSON 로그 별도 저장
- 실행 블록 하이라이트를 DOM에도 표시해서 실시간 미리보기 제공

## 권장 아키텍처

```text
MV3 service worker
  - 컨텍스트 메뉴 생성
  - 팝업/명령 메시지 라우팅

isolated content script
  - 확장 UI/설정 패널
  - MAIN world script 주입
  - page script와 postMessage 통신

MAIN world page script
  - Entry 런타임 탐색
  - 실행 블록 추적
  - 해상도 패치
  - 캔버스/오디오 스트림 생성

recording compositor
  - entryCanvas를 compositeCanvas에 복사
  - 코드 오버레이를 compositeCanvas에 그림
  - compositeCanvas.captureStream() 녹화

recorder
  - MediaRecorder 생성
  - MIME fallback
  - audio track 합성
  - Blob 다운로드
```

## 모듈 설계

### `entry-context`

Entry 런타임을 안정적으로 찾는다.

- `/project/`의 iframe 내부 Entry 탐색
- `/iframe/`, `/noframe/`, `/ws/`의 top-level Entry 탐색
- `.eaizycc0` 같은 빌드 클래스 의존 제거
- `entryCanvas`, `createjs`, `HTMLCanvasElement`, `MediaStreamAudioDestinationNode` 접근 정리

### `resolution-manager`

Entry Recorder의 `changeResolution()`과 BetterEntryScreen의 `setScreenResolution()` 아이디어를 합친다.

- target resolution 적용
- WebGL renderer resize
- canvas 중심점과 scale 보정
- variable/list/input field 좌표 보정
- 적용 전 상태 저장
- 녹화 종료 시 가능한 범위에서 원상복구

### `asset-quality-patcher`

BetterEntryScreen의 SVG/PNG 보정 로직을 참고하되 MVP에서는 선택 기능으로 둔다.

- SVG 원본 asset URL 재로딩
- viewBox 기반 크기 계산
- WebGL texture 교체
- clone entity에도 패치 적용
- 실패 시 기존 Entry 렌더링으로 fallback

주의: 이 모듈은 Entry 내부 구현 의존도가 높으므로 MVP의 필수 경로에서 분리한다.

### `runtime-tracer`

현재 실행 중인 블록 정보를 수집한다.

후킹 후보:

- `Entry.Executor.prototype.execute`
- `Entry.dispatchEvent('blockExecute', view)`
- `Entry.Code.prototype.tick`

MVP에서는 `Executor.prototype.execute` 래핑을 우선한다. 실행 직전 `this.scope.block`을 읽으면 오브젝트, block type, block id, schema, params를 수집하기 쉽다.

수집 데이터 예시:

```ts
interface RunningBlockEvent {
  time: number
  objectId: string
  objectName: string
  blockId: string
  blockType: string
  label: string
  threadType?: string
  isClone?: boolean
}
```

### `block-labeler`

블록 표시 문구를 만든다.

- `Lang.Blocks`의 언어 문자열 사용
- block params를 사람이 읽을 수 있게 치환
- 실패 시 `block.type` 표시
- 함수 호출 블록은 함수 이름 표시

처음에는 완전한 코드 복원보다 "현재 실행 블록 문장"을 우선한다.

### `overlay-renderer`

영상에 들어갈 코드 패널을 그린다.

표시 모드:

- 현재 블록 1개
- 최근 실행 블록 목록
- 오브젝트별 현재 블록
- 함수/신호 이벤트 강조

초기 권장 레이아웃:

- 16:9 영상 기준 오른쪽 28% 너비 패널
- 반투명 검정 배경
- 현재 오브젝트 이름 상단 표시
- 현재 블록은 크게, 최근 블록은 작게
- 같은 블록이 반복 실행될 때 깜빡임 방지용 최소 표시 시간 적용

### `compositor`

녹화 대상 캔버스를 만든다.

```text
requestAnimationFrame loop
  compositeCanvas.clearRect()
  compositeCanvas.drawImage(entryCanvas, stageRect)
  overlayRenderer.draw(currentTraceState)
```

이후 `compositeCanvas.captureStream(fps)`를 MediaRecorder에 넘긴다.

### `recorder`

녹화 안정성을 담당한다.

- `MediaRecorder.isTypeSupported()` 기반 MIME 선택
- 우선순위: MP4 지원 시 MP4, 아니면 WebM
- audio track 연결
- 녹화 중복 방지
- stop/error/finalize 처리
- 파일명 생성

## 개발 단계

### 0단계: 현재 fork 정리

- `package.json`과 `build/manifest.json` 버전 불일치 정리
- `src/content/index.ts`의 단일 파일 구조 분리
- 원본 ISC 라이선스와 BetterEntryScreen MIT 라이선스 고지 방식 결정
- `upstream` 원격 유지, 사용자 fork `origin` 기준 개발

완료 기준:

- `npm run build` 성공
- 기존 녹화 기능 동작 유지

### 1단계: 안정적인 Entry 런타임 탐색

- iframe class 의존 제거
- `window.Entry`, same-origin iframe의 `contentWindow.Entry` 탐색
- Entry readiness 체크 추가
- 작품 페이지가 아닐 때 사용자 안내 개선

완료 기준:

- `/project/`, `/iframe/`, `/noframe/`에서 Entry 탐색 성공
- Entry가 없으면 조용히 실패하지 않고 상태 메시지 표시

### 2단계: 녹화 안정화

- MIME fallback
- 중복 녹화 방지
- 녹화 파일명 지정
- 엔진 상태 확인 후 실행
- stop listener 정리
- 오디오 연결 실패 시 무음 녹화 fallback

완료 기준:

- 소리 있는 작품에서 영상+소리 다운로드
- 소리 API가 없어도 영상만 다운로드
- 두 번 연속 녹화해도 listener와 audio node가 누적되지 않음

### 3단계: 실행 블록 추적 MVP

- `Entry.Executor.prototype.execute` 후킹
- 실행 블록 이벤트 queue 생성
- block type과 오브젝트 이름 표시
- 콘솔 또는 DOM 패널로 실시간 확인

완료 기준:

- 여러 블록이 실행될 때 이벤트가 수집됨
- 반복 블록이 과하게 쌓이지 않도록 throttle 적용
- 실행 종료 시 추적 상태 초기화

### 4단계: DOM 오버레이 미리보기

- 녹화와 별개로 화면 위에 실시간 코드 패널 표시
- 글자 크기와 위치 기본값 확정
- OBS 녹화용으로도 쓸 수 있는 상태 제공

완료 기준:

- 화면에서 현재 실행 블록을 사람이 읽을 수 있음
- 엔트리 조작 UI와 겹침이 심하지 않음

### 5단계: 합성 캔버스 녹화

- `entryCanvas.captureStream()` 대신 `compositeCanvas.captureStream()` 사용
- 매 프레임 Entry 화면과 오버레이를 합성
- 기존 오디오 트랙 연결 유지

완료 기준:

- 다운로드된 영상에 코드 오버레이가 실제로 포함됨
- DOM 오버레이를 꺼도 녹화 파일에는 코드 패널이 들어감

### 6단계: 고해상도 렌더링 개선

- Entry Recorder `changeResolution()` 재검토
- BetterEntryScreen의 WebGL/non-WebGL 분기 반영
- SVG/PNG 품질 보정은 옵션 기능으로 실험
- 해상도별 성능 측정

완료 기준:

- 720p/1080p 안정 녹화
- 1440p는 성능 경고와 함께 옵션 제공
- SVG 작품에서 이미지 품질 개선 여부 확인

### 7단계: 사용성 정리와 패키징

- 팝업 UI 또는 시작 설정 dialog 추가
- Chrome 확장 로드 안내 업데이트
- `build/` 산출물 검증
- 배포 ZIP 생성 스크립트 추가

완료 기준:

- `build/manifest.json`이 ZIP 루트에 위치
- 새로 클론한 환경에서 `npm install` + `npm run build` 성공
- 실제 playentry.org에서 smoke test 완료

## 검증 계획

### 정적 검증

- `npm run build`
- TypeScript type check
- manifest schema 확인
- `git diff --check`

### 브라우저 smoke

- 확장 로드
- 작품 페이지에서 녹화 시작
- 영상 다운로드 확인
- 다운로드 영상 재생 확인
- 오디오 포함 여부 확인
- 코드 오버레이 포함 여부 확인

### 테스트 작품 유형

- 단순 이동 애니메이션
- 소리 재생 작품
- 변수/리스트 화면 표시 작품
- SVG 모양이 포함된 작품
- 여러 오브젝트가 동시에 실행되는 작품
- 신호/함수/복제본을 쓰는 작품

## 주요 리스크

- Entry 내부 API가 비공개라 사이트 업데이트에 취약하다.
- 고해상도 렌더링 패치는 화면 좌표, 변수/리스트 UI, WebGL renderer를 모두 건드린다.
- SVG/PNG 보정은 이미지 로딩 타이밍과 CORS, texture 갱신 타이밍에 민감하다.
- 실행 블록 추적은 동시에 여러 executor가 돌 때 "현재 코드 하나"로 단순화하기 어렵다.
- 합성 캔버스는 고해상도에서 CPU/GPU 부담이 커질 수 있다.
- MP4 MediaRecorder 지원은 브라우저마다 다르다.

## 의사결정

- 확장 프로그램으로 개발한다.
- MVP는 Entry Recorder fork에서 시작한다.
- BetterEntryScreen은 직접 의존성으로 넣기보다 필요한 해상도/이미지 보정 아이디어를 재구현한다.
- 처음부터 완전한 "코드 전체 표시"를 목표로 하지 않고, "현재 실행 블록 표시"를 먼저 완성한다.
- 자체 다운로드 영상에 오버레이를 넣기 위해 합성 캔버스를 최종 녹화 대상으로 사용한다.

## 다음 작업

1. `src/content/index.ts`를 기능별 모듈로 분리한다.
2. `entry-context`와 `recorder`를 먼저 만들고 기존 녹화 기능을 보존한다.
3. `runtime-tracer`를 붙여 DOM 오버레이 MVP를 만든다.
4. 합성 캔버스 녹화로 전환한다.
5. BetterEntryScreen의 해상도 보정 로직을 안전한 옵션 모듈로 흡수한다.

