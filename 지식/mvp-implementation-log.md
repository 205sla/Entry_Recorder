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

## 검증

- `npm install --package-lock=false --ignore-scripts`
- `npm run build`: 성공
- `git diff --check`: 성공
- `node tools/smoke-entry-recorder.mjs`: 8개 smoke 케이스 성공

## 남은 확인

브라우저 실사이트 smoke test는 아직 수행하지 않았다. 다음 작업에서는 playentry.org 실제 작품 페이지에서 확장을 로드하고 다음을 확인해야 한다.

- 녹화 시작/정지
- 다운로드된 영상 재생
- 오디오 포함 여부
- 실행 블록 오버레이가 실제 영상에 포함되는지
- `/project/`, `/iframe/`, `/noframe/`별 Entry 탐색 성공 여부

## 주의점

현재 실행 블록 라벨은 `Lang.Blocks` 템플릿과 block params를 단순 치환한다. 블록 문장을 완전하게 복원하는 단계는 아니므로, 다음 단계에서 주요 블록 유형별 라벨 품질을 개선해야 한다.
