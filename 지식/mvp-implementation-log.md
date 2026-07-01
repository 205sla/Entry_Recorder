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

## 2026-07-01 Entry 원본 블록 스택 이미지 오버레이

- 플레이어 iframe(`Entry.type=minimize`)에서는 실행 중인 `Entry.Block`에 `view`가 붙어 있지 않아 `block.view.getDataUrl()`을 바로 호출할 수 없음을 확인했다.
- 녹화 준비 단계에서 thread가 있는 각 오브젝트 script에 숨겨진 `Entry.Board`를 만들고 `board.changeCode(code)`를 호출해 런타임 block에 원본 `BlockView`를 생성한다.
- 준비 중에는 Entry 작품을 바로 실행하지 않고 iframe 좌상단에 `녹화 준비 중 / 블록 이미지 생성` 표시를 띄운다.
- 준비가 끝난 뒤 `MediaRecorder`와 합성 캔버스를 시작하고, 그 다음 `Entry.engine.toggleRun()`으로 작품을 실행한다.
- 실행 중 `Scope.run`에서 현재 block을 받으면 해당 block의 root stack을 찾아 Entry 원본 SVG를 복제하고 현재 block의 own shape에 노란 stroke/filter를 적용한다.
- SVG 내부 이미지 아이콘은 Blob SVG 안에서 깨질 수 있어 fetch 후 data URL로 인라인한다.
- 원본 stack 이미지가 준비된 프레임부터 영상 오버레이는 실제 Entry 블록 이미지로 전환된다. 이미지 생성이 실패하거나 view를 만들 수 없는 환경에서는 기존 canvas 블록 패널로 fallback 한다.

## 2026-07-01 여러 활성 블록 묶음 동시 표시

- `Scope.run`에서 실행 이벤트가 들어올 때마다 해당 block의 root stack 이미지를 활성 목록에 등록한다.
- 활성 묶음 기준은 `오브젝트/클론 id + root block id`이다. 같은 묶음 안에서 다음 block이 실행되면 새 칸을 만들지 않고 같은 stack 이미지의 현재 실행 강조만 갱신한다.
- Entry 런타임이 현재 실행 중인 전체 thread 목록을 안정적인 공개 API로 제공하지 않기 때문에, 최근 `1200ms` 안에 실행 이벤트가 들어온 stack을 동작 중인 묶음으로 본다.
- 동시에 준비된 stack 이미지가 여러 개면 기존 오버레이 영역 안에서 격자로 배치한다. 준비된 원본 이미지가 없으면 기존처럼 단일 현재 stack 또는 canvas fallback 패널을 사용한다.

## 2026-07-01 묶음별 오브젝트 표시와 조립소 배경

- 원본 BlockView stack 이미지 셀마다 오브젝트 마커, 오브젝트 이름, 묶음 블럭 수 badge를 표시한다.
- 블럭 수는 `thread.countBlock()`을 우선 사용하고, 없으면 root stack의 top-level block과 중첩 statement/param block을 순회해 계산한다.
- 오브젝트 thumbnail을 원격 이미지로 바로 그리면 녹화용 canvas가 taint될 위험이 있어, 현재는 오브젝트 id/name 기반 색상 마커와 이름을 사용한다.
- 패널과 각 stack 셀의 배경을 단색 카드가 아닌 Entry 블럭 조립소 느낌의 밝은 점무늬 작업창 배경으로 통일했다.
- 활성 stack이 2개 이상이면 패널을 조금 넓고 높게 잡고, 좁은 셀에서는 badge를 `5개`처럼 축약해 오브젝트 이름 공간을 확보한다.

## 검증

- `npm install --package-lock=false --ignore-scripts`
- `npm run build`: 성공
- `git diff --check`: 성공
- `node tools/smoke-entry-recorder.mjs`: 8개 smoke 케이스 성공
- 실제 작품 `6a3781996e2f06d9323a9bec`: `REC 녹화 중` 표시 노출 및 정지 후 제거, `entry-recording-20260701-005331.mp4` 다운로드 성공
- 실제 작품 `6a3781996e2f06d9323a9bec`: 블록 이미지 오버레이 적용 후 `entry-recording-20260701-010809.mp4` 다운로드 성공, 5초 프레임에서 한국어 블록/인자 capsule/단일 `NOW` 표시 확인
- 실제 작품 `6a3781996e2f06d9323a9bec`: Entry 원본 BlockView 스택 오버레이 적용 후 `entry-recording-20260701-141840.mp4` 다운로드 성공, `ffprobe` 기준 duration `10.512800`, size `7417945`, video `h264 2560x1440`, audio `aac`.
- 추출 프레임 `C:\tmp\entry-recorder-real-smoke\output\real-block-stack-frame-5s-inline-icons.png`에서 원본 Entry 블록 스택, 시작 아이콘, 현재 실행 블록 노란 강조 표시를 확인했다.
- 실제 작품 `6a3781996e2f06d9323a9bec`: 여러 활성 블록 묶음 동시 표시 적용 후 `entry-recording-20260701-142758.mp4` 다운로드 성공, `ffprobe` 기준 duration `10.349100`, size `8206064`, video `h264 2560x1440`.
- 추출 프레임 `C:\tmp\entry-recorder-real-smoke\output\real-multi-active-stacks-frame-5s.png`에서 여러 Entry 원본 BlockView 스택이 격자로 표시되고 각 묶음의 현재 실행 블록 강조가 보임을 확인했다.
- 실제 작품 `6a3781996e2f06d9323a9bec`: 묶음별 오브젝트 표시/조립소 배경 적용 후 `entry-recording-20260701-143737.mp4` 다운로드 성공, `ffprobe` 기준 duration `10.958500`, size `5773657`, video `h264 2560x1440`.
- 추출 프레임 `C:\tmp\entry-recorder-real-smoke\output\real-object-labeled-stack-frame-5s-wide.png`에서 stack 셀별 오브젝트 이름, 색상 마커, 블럭 수, 점무늬 배경을 확인했다.

## 남은 확인

다음 작업에서는 playentry.org 실제 작품 페이지에서 더 다양한 블록 유형을 확인해야 한다.

- `/project/`, `/iframe/`, `/noframe/`별 Entry 탐색 성공 여부
- 긴 stack/여러 statement/사용자 함수 블록 이미지의 축소 비율과 강조 위치
- 숨겨진 `Entry.Board` 생성 비용이 큰 대형 작품에서 준비 시간
- 실제 블록 이미지가 만들어지지 않는 구형 Entry 런타임에서 fallback 품질

## 주의점

현재 오버레이는 가능한 경우 Entry 원본 `BlockView`로 만든 root stack 이미지를 사용한다. 다만 플레이어 런타임에 `Entry.Board`/`BlockView`가 없거나 숨겨진 view 생성에 실패하면 이전 canvas 기반 블록 패널로 fallback 한다.
