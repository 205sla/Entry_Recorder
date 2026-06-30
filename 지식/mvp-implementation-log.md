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

## 검증

- `npm install --package-lock=false --ignore-scripts`
- `npm run build`: 성공
- `git diff --check`: 성공

## 남은 확인

브라우저 실사이트 smoke test는 아직 수행하지 않았다. 다음 작업에서는 playentry.org 실제 작품 페이지에서 확장을 로드하고 다음을 확인해야 한다.

- 녹화 시작/정지
- 다운로드된 영상 재생
- 오디오 포함 여부
- 실행 블록 오버레이가 실제 영상에 포함되는지
- `/project/`, `/iframe/`, `/noframe/`별 Entry 탐색 성공 여부

## 주의점

현재 실행 블록 라벨은 `Lang.Blocks` 템플릿과 block params를 단순 치환한다. 블록 문장을 완전하게 복원하는 단계는 아니므로, 다음 단계에서 주요 블록 유형별 라벨 품질을 개선해야 한다.
