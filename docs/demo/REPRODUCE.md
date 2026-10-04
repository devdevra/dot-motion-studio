# 한국어 데모 재현 안내

이 폴더는 **실제 `lib/motion-engine.mjs`를 실행한 출력물**과, 그 출력물로 별도 편집한 **24초 한국어 설명 영상**을 담고 있습니다. 화면 녹화나 라이브 MCP 연결 성공 증거가 아닙니다.

## 빠르게 보기

- [한국어 MP4 설명 영상](./dot-motion-demo-ko.mp4): 1280×720, 12fps, 24초, 무음
- [움직이는 GIF 미리보기](./dot-motion-demo-ko.gif): 768×432, 약 24초, 8 FPS, 1,519,271바이트
- [포스터](./dot-motion-demo-poster.png)
- [한국어 전체 설명](./TRANSCRIPT.ko.md), [WebVTT](./dot-motion-demo-ko.vtt), [SRT](./dot-motion-demo-ko.srt)

자막이 영상에 직접 들어 있습니다. MP4와 용량을 줄인 GIF를 함께 제공합니다. 정확한 12fps 재생은 MP4를 확인하세요.

## 입력과 실제 결과

| 항목 | 파일 / 값 |
|---|---|
| 입력 | [golf-ball-input.png](./golf-ball-input.png), 96×96 RGBA PNG |
| 이동 | 16프레임, 매 프레임 X +12px / Y 0px |
| 재생 속도 | 12fps, 16프레임 한 주기 약 1.33초 |
| 개별 프레임 | 276×96px |
| 아틀라스 | [golf-ball-atlas.png](./golf-ball-atlas.png), 1104×384px, 4×4칸 |
| 메타데이터 | [golf-ball-atlas.json](./golf-ball-atlas.json) |
| 프레임 묶음 | [golf-ball-frames.zip](./golf-ball-frames.zip), PNG 16장 + JSON 1개 |
| 실행 옵션 | [golf-ball-options.json](./golf-ball-options.json) |

입력은 이 데모용으로 built-in imagegen에서 새로 생성한 골프공입니다. 준비 단계에서 원본 1254×1254 RGBA 이미지를 Pillow의 Lanczos 방식으로 96×96으로 축소해 엔진 입력 제한 안에 맞췄습니다. 생성 프롬프트와 출처는 [input-provenance.json](./input-provenance.json)에 있습니다. 사용자 개인 이미지나 외부 스톡 이미지를 사용하지 않았습니다.

**이미지 생성과 축소는 데모 준비 작업이며 Dot Motion 엔진 기능이 아닙니다.** 재현 스크립트는 체크인된 96×96 PNG에서 시작하므로 다시 이미지 생성 서비스를 호출할 필요가 없습니다. 생성 모델을 다시 호출하면 같은 그림이 재생성된다는 뜻은 아닙니다.

## 실제 엔진 실행

프로젝트 루트에서 의존성을 준비한 다음 실행합니다. 엔진 재현은 Node.js와 프로젝트의 `fflate` 의존성만 사용합니다.

```sh
npm run install:ci
node docs/demo/generate-demo.mjs
```

실행 스크립트는 실제 `runPipeline`을 두 번 호출하고 결과를 비교합니다. PNG 시퀀스를 `.build/`에 풀어 영상 렌더링에 사용하며, `.build/`는 Git 대상에서 제외되어 있습니다.

옵션은 다음과 같습니다.

```json
{
  "name": "golf-ball",
  "fps": 12,
  "source": { "kind": "single" },
  "alphaThreshold": 0,
  "normalize": { "padding": 0, "align": "center", "trim": false },
  "motion": { "frames": 16, "dx": 12, "dy": 0 },
  "atlasColumns": 4
}
```

## 영상과 GIF 재현

추가 준비물: Python 3, Pillow, FFmpeg/ffprobe, Noto Sans CJK Regular/Bold 글꼴. 이 환경에서는 Pillow 12.3.0과 FFmpeg 7.1.5를 사용했습니다.

```sh
python3 docs/demo/render-demo.py
```

Linux의 Noto CJK 기본 글꼴 경로를 사용합니다. 다른 경로에서는 `DEMO_FONT_REGULAR`, `DEMO_FONT_BOLD` 환경변수로 설정할 수 있습니다. 글꼴과 인코더 버전이 다르면 영상의 바이너리 해시는 달라질 수 있습니다.

렌더러는 실제 출력 PNG 프레임 위에 한국어 설명과 투명도 확인용 체크무늬를 얹습니다. MP4는 FFmpeg의 H.264/yuv420p 및 faststart로, GIF는 축소·팔레트 최적화로 인코딩합니다. 영상에는 음악이나 음성 트랙이 없습니다. 별도의 유료 AI 영상·음성 공급자를 사용하지 않았습니다.

## 확인한 내용

- 입력 RGBA의 완전 투명 픽셀 5,068개, 부분 투명 픽셀 3,989개, 불투명 픽셀 159개
- 16프레임 모두 원본과 동일한 RGBA 픽셀을 그대로 이동했고 잘리지 않음
- 시퀀스의 각 픽셀과 아틀라스의 해당 영역이 일치
- 같은 입력/옵션으로 두 번 실행한 아틀라스·JSON·ZIP 바이트가 일치
- ZIP에 PNG 16장과 JSON 1개가 들어 있음
- MP4 전체를 FFmpeg로 오류 없이 디코딩
- GIF도 전체 디코딩을 검증했으며, 제작 당시의 정확한 바이트로 공개
- 대표 4장면을 직접 확인해 한글 자막, 배치, 프레임 표시 및 실제 결과를 점검

기계 검증 결과: [engine-verification.json](./engine-verification.json), [media-verification.json](./media-verification.json). 체크인된 파일의 SHA-256: [SHA256SUMS.txt](./SHA256SUMS.txt). `media-verification.json`의 GIF 항목은 공개된 파일의 검증 기록이며 `published: true`로 표시됩니다.

## 데모가 보여주는 범위

골프공의 **단순 2D 평행이동**입니다. 원래 자세를 바꾸거나 회전시키지 않습니다. 골프 스윙 포즈, 실제 공의 비행 물리, 새 동작 생성, 이미지의 의미를 이해하는 배경 제거는 보여주지 않습니다. 입력의 alphaThreshold는 0이므로 이 예제는 반투명 테두리 제거를 시연하지 않습니다.

엔진의 기본 출력은 **PNG 아틀라스, JSON 메타데이터, PNG 시퀀스 ZIP**입니다. 이 폴더의 MP4와 GIF는 실제 엔진 출력물을 사용해 **외부 FFmpeg로 조립한 설명 자료**입니다. 영상 속 아틀라스 격자·번호·체크무늬는 설명을 위한 표시이고, 실제 PNG 출력에는 들어 있지 않습니다.
