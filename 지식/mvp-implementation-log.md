# MVP 구현 기록

작성일: 2026-06-30

## 구현 범위

첫 개발 단계로 실행 코드 오버레이 녹화 MVP를 추가했다.

- Entry 런타임 탐색을 `.eaizycc0` iframe class 의존에서 same-origin window/iframe 탐색 방식으로 변경
- `MediaRecorder.isTypeSupported()` 기반 MIME fallback 추가
- 녹화 중복 실행 방지
- 녹화 파일명 자동 생성
- SoundJS WebAudio 연결 실패 시 무음 녹화 fallback
- `Entry.Scope.prototype.run` 후킹 기반 실행 블록 추적
- 최근 실행 블록 queue 유지
- 원본 Entry 캔버스와 실행 블록 패널을 합성하는 `compositeCanvas` 추가
- `compositeCanvas.captureStream()`을 녹화 대상으로 사용해 코드 오버레이가 다운로드 영상에 포함될 수 있도록 변경

## 추가된 모듈

- `src/content/entry-context.ts`: Entry 런타임, canvas, createjs 탐색
- `src/content/runtime-tracer.ts`: 실행 블록 추적
- `src/content/overlay-renderer.ts`: 녹화용 코드 패널 렌더링
- `src/content/compositor.ts`: 원본 캔버스와 오버레이 합성

## 2026-07-01 smoke 디버깅

- 브라우저 정책상 `file://`/localhost in-app smoke는 실행하지 못해 Node `vm` 기반 smoke harness를 추가했다.
- `tools/smoke-entry-recorder.mjs`에서 top window/iframe, 2D/WebGL, WebGL render hook 누락 fallback 케이스를 검증한다.
- Entry 런타임과 `Entry.Scope.prototype.run`이 준비될 때까지 최대 8초 대기하도록 시작 흐름을 보강했다.
- WebGL에서 `stage._app.render`를 후킹할 수 없을 때도 RAF 합성 루프로 fallback 하도록 수정했다.
- `changeResolution()`은 Entry 내부 stage/container/variable 필드가 일부 비어 있어도 녹화 시작이 중단되지 않도록 방어적으로 변경했다.

## 2026-07-01 실제 작품 테스트

- 기준 작품: `https://playentry.org/project/6a3781996e2f06d9323a9bec`
- 재현 실패: 실행 후 10초 뒤 iframe 내부 `button.entryStopButtonMinimize` 정지 버튼을 클릭하면 Entry 실행 상태는 `run=false`가 되지만 `Entry.addEventListener('stop')` 이벤트가 오지 않아 `__ENTRY_RECORDER_SESSION__`이 active로 남고 다운로드가 발생하지 않았다.
- 수정: iframe document의 `.entryStopButtonMinimize` click capture와 engine run 상태 전환 polling을 fallback으로 추가했다.
- 수정 후 결과: 10초 녹화 뒤 실제 정지 버튼 클릭으로 `entry-recording-20260701-004236.mp4` 다운로드 성공.
- `ffprobe` 확인: duration `10.150033`, size `7072593`, video `h264 2560x1440`, audio `aac`.
- 추출 프레임 확인: 5초 프레임에 실행 코드 오버레이가 포함됨.

## 2026-07-01 녹화 중 표시

- 녹화가 시작되면 Entry iframe 화면 좌상단에 `REC 녹화 중 00:00` 상태 표시를 띄우도록 추가했다.
- 상태 표시는 브라우저 화면 피드백용 DOM overlay이며, 다운로드되는 녹화 영상에는 기존 실행 코드 오버레이만 포함된다.
- 정지/다운로드 cleanup 시 상태 표시와 타이머를 제거한다.
- 실제 작품 기준 테스트에서 상태 표시 노출, 정지 후 제거, 10초 MP4 다운로드를 확인했다.

## 2026-07-01 블록 이미지 오버레이

- 녹화 영상에 합성되는 실행 코드 오버레이를 텍스트 패널에서 Entry 작업창 느낌의 블록 이미지 패널로 변경했다.
- `runtime-tracer`가 `Lang.Blocks` 템플릿을 text/param token으로 분리하고, `Entry.block[type]`의 color/skeleton/class를 가능한 경우 함께 저장한다.
- 런타임 템플릿이 설명문만 제공하거나 누락되는 기본 블록은 fallback 템플릿으로 한국어 블록 문구를 보강한다.
- `overlay-renderer`가 밝은 점 격자 배경, 오브젝트 헤더, 블록 개수 badge, 시작/일반/반복 블록 형태, 숫자/문자 인자 capsule, 현재 실행 `NOW` 표시를 캔버스에 그린다.
- Entry 내부 `BlockView` SVG를 직접 재사용하지 않고 녹화용 canvas renderer로 구현했다. 실제 작업창 렌더러와 분리되어 녹화 안정성을 우선한다.

## 검증

- `npm install --package-lock=false --ignore-scripts`
- `npm run build`: 성공
- `git diff --check`: 성공
- `node tools/smoke-entry-recorder.mjs`: 8개 smoke 케이스 성공
- 실제 작품 `6a3781996e2f06d9323a9bec`: `REC 녹화 중` 표시 노출 및 정지 후 제거, `entry-recording-20260701-005331.mp4` 다운로드 성공
- 실제 작품 `6a3781996e2f06d9323a9bec`: 블록 이미지 오버레이 적용 후 `entry-recording-20260701-010809.mp4` 다운로드 성공, 5초 프레임에서 한국어 블록/인자 capsule/단일 `NOW` 표시 확인

## 남은 확인

다음 작업에서는 playentry.org 실제 작품 페이지에서 더 다양한 블록 유형을 확인해야 한다.

- `/project/`, `/iframe/`, `/noframe/`별 Entry 탐색 성공 여부
- 반복/조건/계산/변수/리스트/사용자 함수 블록의 토큰 표시 품질
- 실행 중인 전체 스크립트 묶음 복원 가능 여부

## 주의점

현재 오버레이는 최근 실행 블록들을 블록 모양으로 렌더링한다. Entry 작업창의 전체 스크립트 묶음을 그대로 캡처하는 단계는 아니므로, 다음 단계에서 block/thread 연결 구조를 따라 전체 스택 복원을 검토해야 한다.
