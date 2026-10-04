# 골프의 순간 · 한글 타이포그래픽 모션

[10초 한국어 영상](./typography-ko.mp4) · [입력/출력 비교](./typography-comparison.png) · [영상 설명](./TRANSCRIPT.ko.md)

[![골프의 순간 한글 타이포그래픽 모션](./typography-poster.png)](./typography-ko.mp4)

“골프의 순간” 다섯 글자가 위아래에서 차례로 등장하고, 같은 기준선에 멈추는 타이포그래픽 샘플입니다. 짙은 초록 배경과 크림색 글자, 라임색 선으로 구성했습니다. 영상은 모바일에서 보기 좋은 정사각형입니다.

## 실제로 어떤 작업을 했나요?

1. **외부 준비:** Noto Sans CJK KR 폰트로 글자 이동·등장·불투명도·선을 미리 그린 16프레임을 만들었습니다. [원본 입력 PNG](./typography-source.png)는 4×4칸, 960×512픽셀입니다.
2. **실제 엔진 실행:** 변경하지 않은 `lib/motion-engine.mjs`의 `runPipeline`을 호출해 한 칸씩 분리했습니다. 240×128 고정 캔버스와 알파를 유지하며 PNG 아틀라스·JSON·시퀀스 ZIP을 만들었습니다.
3. **별도 영상 편집:** 엔진이 출력한 실제 PNG 프레임을 8 FPS로 재생하고, 한국어 설명과 배경을 추가해 FFmpeg로 MP4를 조립했습니다.

**글자 애니메이션을 엔진이 생성한 것은 아닙니다.** 문자 렌더링·이징·리빌은 입력 프레임을 준비하는 외부 스크립트의 작업입니다. 이 영상은 화면 녹화나 라이브 MCP 성공 시연이 아니며, MP4 역시 엔진의 기본 출력이 아닙니다.

## 결과 파일

- [입력 스프라이트 시트](./typography-source.png): 투명 RGBA PNG, 960×512, 16프레임
- [실제 엔진 아틀라스](./typography-atlas.png): 투명 RGBA PNG, 960×512
- [아틀라스 JSON](./typography-atlas.json): 프레임 좌표·크기·8 FPS·프레임당 125 ms
- [PNG 시퀀스 ZIP](./typography-frames.zip): 240×128 PNG 16장과 JSON 1개
- [한국어 MP4](./typography-ko.mp4): 720×720, 24 FPS, 10초, 무음, 자막 포함
- [한국어 SRT](./typography-ko.srt), [비교 이미지](./typography-comparison.png), [포스터](./typography-poster.png)

MP4에는 초록 배경이 합성되어 있습니다. 투명 이미지가 필요하면 PNG나 ZIP을 사용하세요. PNG 자체에는 재생 시간이 없으므로 JSON을 함께 사용합니다.

## 설정과 검증

[실제 설정 파일](./typography-options.json): 명시적인 4×4 행 우선 순서, 16프레임, 8 FPS, 알파 임계값 0, `trim:false`, 여백 0, 240×128 고정 캔버스, 아틀라스 열 4

- 입력: 491,520픽셀, 2 MiB보다 작은 PNG
- 출력 프레임과 아틀라스 합계: **983,040픽셀**, 엔진 한도 1,000,000픽셀 이내
- 16개 입력 셀·ZIP 프레임·아틀라스 셀의 **RGBA 픽셀이 완전히 일치**
- 투명 픽셀과 부분 알파, 프레임 순서, 고정 캔버스 및 앵커 보존 확인
- MP4 240프레임 전체 디코딩 성공, 실제 디코딩된 주요 프레임과 360픽셀 모바일 미리보기 육안 검토
- 영상 내 재생은 원본 8 FPS 프레임을 각각 3번 표시한 24 FPS이며, 보간 프레임을 만들지 않음

메타데이터의 `loop:true`는 반복 재생 힌트입니다. 이 모션은 등장 후 유지하다 처음으로 다시 시작하는 구성입니다. 무봉제 루프로 표현하지 않았습니다.

[엔진 검증](./engine-verification.json) · [영상 검증](./media-verification.json) · [입력 출처](./input-provenance.json) · [SHA-256](./SHA256SUMS.txt)

## 재현

저장소 의존성 및 Node.js, Python 3/Pillow, FFmpeg/ffprobe, Noto Sans CJK Regular/Bold가 필요합니다. 저장소 루트에서 실행합니다.

```sh
sh docs/extra-cases/typography/reproduce.sh
```

스크립트 순서는 `prepare-source.py` → `build-engine.mjs` → `render-video.py` → `verify-media.py`입니다. 모든 입출력은 이 예제 폴더에 한정됩니다. 검사용 중간 파일은 `.build/`에 저장되어 Git에서 제외됩니다.

기본 폰트는 시스템의 Noto Sans CJK TTC, 한국어 인덱스 1입니다. 다른 설치 경로는 `TYPE_FONT_BOLD`, `TYPE_FONT_REGULAR`, `TYPE_FONT_INDEX` 환경 변수로 지정할 수 있습니다. 다른 폰트나 렌더링 라이브러리 버전은 픽셀·파일 해시에 영향을 줄 수 있습니다. 실행에 사용한 폰트 해시는 입력 출처에 기록되어 있으며 폰트 파일은 재배포하지 않습니다. 시스템 패키지의 라이선스는 SIL Open Font License 1.1입니다.

이 예제는 네트워크 요청이나 유료 서비스 호출 없이 로컬에서 재현할 수 있습니다.
