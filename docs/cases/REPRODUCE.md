# 세 가지 모션 예제 재현

저장소 루트 기준입니다. Node.js 22+, 설치된 `fflate`, Python 3/Pillow, Noto Sans CJK 글꼴, FFmpeg(libx264 포함), ffprobe가 필요합니다. 네트워크·유료 API·새 AI 포즈 생성은 사용하지 않습니다.

## 현재 공개된 파일 검증

```sh
(cd docs/cases && sha256sum -c SHA256SUMS.txt)
python3 docs/cases/verify-cases.py --published-only
```

공개 검증은 준비 입력의 해시, 변경하지 않은 엔진, PNG 24개의 입력 셀·아틀라스·ZIP 픽셀 일치, 세 개별 4초 MP4의 총 288프레임 및 통합 MP4의 사례별 표본 72프레임 순서, 모든 포함 영상의 전체 디코딩, 실제 공개 파일의 문서 링크를 확인합니다. `final-verification.json`과 공개 범위의 `SHA256SUMS.txt`를 새로 기록합니다.

현재 3종 동시 빠른 GIF, 큰 AI 원본 3개와 로봇·마스코트의 선택적 배경 합성 QA JPEG는 공개 배포에 포함하지 않습니다. 미디어 기록에서 `published: false`인 항목과 출처 기록의 원본 해시는 제작 당시 식별·검증 기록입니다. 위 명령은 이 파일을 요구하거나 검증했다고 주장하지 않습니다.

## 준비된 입력부터 재현

```sh
python3 docs/cases/inputs/prepare_inputs.py --use-prepared
node docs/cases/build-cases.mjs
python3 docs/cases/render-cases.py
python3 docs/cases/verify-cases.py --published-only
```

`--use-prepared`는 공개된 512×256 입력 PNG 3개의 지정 SHA-256만 확인하며 파일을 쓰지 않습니다. 엔진은 명시적인 4×2 격자를 128×128 프레임으로 분리하고, 알파 0의 보이지 않는 RGB만 정규화합니다. 셀 앵커와 나머지 픽셀은 보존합니다.

렌더러는 실제 엔진 출력으로 세 개별 384×448 / 4초 / 24 FPS MP4, 포스터, 24프레임 비교 이미지, 한국어 SRT/VTT를 만듭니다. 현재 공개된 1280×720 / 36초 통합 MP4도 재현합니다. 추가로 배포에서 제외한 768×256 / 2초 동시 GIF를 사용자의 로컬에서 만들 수 있습니다. 그 생성은 저장소 게시를 의미하지 않습니다. 글꼴·FFmpeg 버전에 따라 재인코딩 해시가 달라질 수 있으므로 기존 파일의 정확한 해시는 재생성 전에 확인하세요.

모션 재생은 로봇·마스코트 8 FPS, 깃발 12 FPS입니다. 24 FPS MP4는 기존 포즈를 반복하며 새 포즈를 보간하지 않습니다. 영상은 무음이며 체크무늬는 투명도 확인용 합성 배경입니다. MP4 자체는 투명하지 않습니다.

중간 검토 파일은 `.build/`에 저장되어 배포에서 제외됩니다. 글꼴 경로는 `DEMO_FONT_REGULAR`, `DEMO_FONT_BOLD`로 바꿀 수 있습니다.

## AI 원본 준비 단계: 공개 재현 대기

큰 원본 시트는 이번 배포에서 제외했으므로 옵션 없는 `inputs/prepare_inputs.py`는 원본이 없는 공개 체크아웃에서 안내와 함께 중단합니다. 공개 입력을 사용하려면 `--use-prepared`를 쓰세요. 나중에 원본을 별도로 갖춘 환경에서만 원본 준비 단계를 반복할 수 있습니다. `--generated-dir`은 로컬 대체 폴더를 지정하는 옵션이며 다운로드 기능이 아닙니다.

제작 시에는 원본의 4×2 셀을 같은 비율로 축소하고, 각 셀 전체를 지면·깃대 기준점으로 평행 이동했습니다. 변환과 해시는 `inputs/input-provenance.json`에 기록되어 있습니다. AI 생성은 비결정적이므로 프롬프트를 다시 실행해 같은 바이트를 얻는다고 주장하지 않습니다.

검증 범위는 로컬 엔진과 별도 FFmpeg 제작입니다. 라이브 MCP 연결·인증이나 앱 UI 실행을 증명하지 않습니다.
