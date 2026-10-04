# Dot Motion Studio · 움직이는 3종 예제

미리 그린 AI 원본 프레임을 **변경하지 않은 실제 `lib/motion-engine.mjs`의 `runPipeline`**으로 추출하고 재생한 예제입니다.

## 먼저 보기

- 아래의 **각 사례별 4초 MP4**에서 실제 추출 PNG의 움직임을 확인하세요
- 36초 통합 한국어 설명 영상과 빠른 GIF는 제작·검증됐지만 **현재 공개 배포에는 포함하지 않았습니다**
- [대표 이미지](dot-motion-cases-poster.png) / [24프레임 비교 이미지](dot-motion-cases-contact-sheet.png)
- 통합 영상용 텍스트 자막: [SRT](dot-motion-cases-ko.srt) / [WebVTT](dot-motion-cases-ko.vtt). 통합 영상 파일 공개 대기 중에도 설명을 읽을 수 있습니다

## 세 가지 사례

| 예제 | 입력 | 재생 | 개별 미리보기 | 엔진 결과 |
| --- | --- | --- | --- | --- |
| 로봇 제자리 걷기 | [투명 PNG](inputs/robot-walk.png) | 8프레임 · 8 FPS | [4초 MP4](outputs/robot-walk/robot-walk-preview.mp4) | [atlas PNG](outputs/robot-walk/robot-walk-atlas.png) · [JSON](outputs/robot-walk/robot-walk-atlas.json) · [PNG ZIP](outputs/robot-walk/robot-walk-frames.zip) |
| 마스코트 표정 전환 | [투명 PNG](inputs/mascot-expression.png) | 8프레임 · 8 FPS | [4초 MP4](outputs/mascot-expression/mascot-expression-preview.mp4) | [atlas PNG](outputs/mascot-expression/mascot-expression-atlas.png) · [JSON](outputs/mascot-expression/mascot-expression-atlas.json) · [PNG ZIP](outputs/mascot-expression/mascot-expression-frames.zip) |
| 깃발 펄럭임 | [투명 PNG](inputs/flag-wave.png) | 8프레임 · 12 FPS | [4초 MP4](outputs/flag-wave/flag-wave-preview.mp4) | [atlas PNG](outputs/flag-wave/flag-wave-atlas.png) · [JSON](outputs/flag-wave/flag-wave-atlas.json) · [PNG ZIP](outputs/flag-wave/flag-wave-frames.zip) |

## 무엇을 검증했나요?

- 각 입력은 512×256 RGBA PNG이며, 4열×2행에 128×128 프레임 8개가 들어 있습니다
- `source.kind: "grid"`, `count: 8`, `margin: 0`, `spacing: 0`으로 **왼쪽 → 오른쪽, 위 → 아래** 순서를 명시했습니다
- `normalize: { trim: false, padding: 0, width: 128, height: 128, align: "center" }`로 준비된 입력의 셀과 앵커를 그대로 보존합니다
- `alphaThreshold: 0`은 이미 완전히 투명한 픽셀의 보이지 않는 RGB만 0으로 정리합니다. 불투명 배경 제거 기능이 아닙니다
- 프레임 PNG 24개 모두 입력 셀과 픽셀 단위 비교를 통과했습니다. 알파 0의 RGB 정규화 이외에는 변하지 않았습니다
- 출력 아틀라스의 각 셀과 개별 PNG도 픽셀 단위로 같습니다. 각 ZIP은 프레임 8개와 JSON 1개를 포함합니다
- 엔진 SHA-256, 입력·출력 크기와 해시, 정확한 옵션은 [엔진 검증 기록](engine-verification.json)에 있습니다
- 세 개별 MP4의 전체 디코딩과 프레임 순서를 다시 확인했습니다. [미디어 검증 기록](media-verification.json)의 `published: false` 항목은 미공개 통합 MP4/GIF의 제작 당시 기록입니다

## AI와 도구의 역할

1. **AI 이미지 생성**: 이미 서로 다른 포즈·표정·천 모양을 가진 8프레임 시트를 먼저 그렸습니다
2. **별도 입력 준비 스크립트**: 일정 비율 축소와 셀 단위의 평행이동으로 기준점을 맞췄습니다. 새 포즈 생성, 다시 그리기, 보간은 하지 않았습니다. 특히 AI 원본의 깃대 좌표 편차를 이 준비 단계에서 맞췄습니다. [원본·프롬프트·변환 기록](inputs/input-provenance.json)
3. **Dot Motion 엔진**: 준비된 시트를 명시적 격자로 분리하고, 투명도를 정리하고, 셀 앵커를 보존하여 PNG 아틀라스·JSON·PNG 시퀀스 ZIP을 내보냈습니다
4. **별도 FFmpeg**: 실제 출력 PNG를 재생하여 설명용 MP4/GIF를 만들었습니다. MP4/GIF는 엔진의 기본 출력 형식이 아닙니다

체크무늬는 투명 영역을 보여 주기 위한 합성 배경입니다. MP4는 투명 영상이 아닙니다. 영상은 무음이며, 앱 화면 녹화나 라이브 MCP 호출 기록이 아닙니다.

## 시각 품질과 한계

- **로봇**: 다리·팔이 바뀌는 제자리 행진입니다. AI가 그린 스타일화된 보행이라 실제 보행 주기와 정확히 일치하지 않고, 몸·머리의 작은 형태 차이와 반복 경계의 튐이 남습니다
- **마스코트**: 차분함 → 반쯤 감은 눈 → 깜박임 → 눈 뜸 → 미소 → 활짝 웃음 → 잔잔한 웃음 → 차분함. 실루엣은 안정적이지만 음영·외곽선의 미세한 차이는 있습니다
- **깃발**: 서로 다른 8개의 천 모양을 재생합니다. 준비 단계에서 깃대 기준점을 맞췄지만 물리 시뮬레이션이 아니며, 천의 위상 변화가 완벽하게 균일하지는 않습니다
- 원본 포즈의 시간적 일관성을 엔진이 보정하지 않습니다. JSON의 `loop: true`는 반복 재생 힌트일 뿐, 매끈한 반복을 보장하지 않습니다
- **검증 범위는 로컬 엔진 실행입니다. 라이브 MCP 플러그인 연결·인증은 이 예제에서 확인하지 못했습니다**

## 현재 공개 범위

준비된 입력 PNG 3개, 실제 엔진 출력 PNG 24개·아틀라스·JSON·ZIP, 개별 MP4 3개와 설명 자료를 제공합니다. 큰 AI 원본 시트 3개는 이번 배포에서 제외했습니다. 출처 기록의 원본 파일명·해시는 제작 당시 식별 정보이며 다운로드 링크가 아닙니다. **준비된 입력부터 엔진과 미디어를 재현할 수 있지만 AI 원본에서 입력을 만드는 단계의 공개 재현은 아직 제공하지 않습니다.**

## 재현

[재현 방법](REPRODUCE.md) · [전체 파일 SHA-256](SHA256SUMS.txt)
