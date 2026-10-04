# 골프 스윙 데모 재현

저장소 루트 기준입니다. Node.js와 설치된 `fflate`, Python의 Pillow 및 NumPy, FFmpeg/ffprobe, Noto Sans CJK가 필요합니다. 스크립트는 네트워크를 사용하지 않습니다.

## 제공 파일을 먼저 정확하게 검증

```bash
cd docs/extra-cases/golf-swing
sha256sum -c SHA256SUMS.txt
python verify-demo.py
```

`verify-demo.py`는 모든 MP4 프레임의 골퍼 영역을 8개의 실제 엔진 PNG와 비교해 가장 가까운 포즈가 해당 타임라인과 일치하는지 확인합니다. H.264는 손실 인코딩이므로 영상은 픽셀 동일성 대신 RGB 평균 절대오차 및 포즈 식별로 확인합니다. PNG/아틀라스는 `build-engine.mjs`가 픽셀 동일성을 정확히 검증합니다.

## 공개된 입력에서 재생성

```bash
python prepare-input.py --use-prepared
node build-engine.mjs
python render-demo.py
python verify-demo.py --skip-manifest
```

1. 공개된 `golf-swing-input.png`의 SHA-256을 확인하고 그대로 사용합니다. AI 원본은 공개 대기 중이므로 이 경로는 원본 준비를 수행하지 않습니다.
2. 실제 엔진에 `source.kind: grid`, `columns: 4`, `rows: 2`, `count: 8`, `trim: false`, `alphaThreshold: 0`을 전달합니다.
3. 실제 출력 PNG를 영상에 표시하고 FFmpeg로 조립합니다. 실제 출력 프레임 외 중간 포즈는 만들지 않습니다.

### 원본 준비 단계: 공개 재현 대기 중

AI 원본 PNG는 현재 배포에 포함하지 않습니다. 따라서 원본부터 전체 과정을 재현할 수 있다고 주장하지 않습니다. 출처 기록의 원본 파일명과 SHA-256은 제작 당시 식별 정보이며 다운로드 링크가 아닙니다.

`prepare-input.py`를 옵션 없이 실행하면 로컬에 원본이 있을 때만 다음 준비를 수행하고, 원본이 없으면 명확한 안내와 함께 중단합니다. 공개 입력을 쓰려면 위의 `--use-prepared` 경로를 사용하세요.

- 제작 시 원본을 4×2로 잘라 각 셀에 공통 0.40 배율을 적용했습니다. 정수 치수 반올림 차이는 최대 1픽셀입니다.
- 셀 하단 15%의 알파 128 이상 영역에서 발 경계를 측정하고, 셀 전체를 192×192 캔버스의 발 중심 `(96,180)`에 평행 이동했습니다. 각 셀의 원래 알파는 유지했습니다.
- 불투명 픽셀의 클리핑이 없는지 검사하고 768×384 입력 PNG를 저장했습니다.

`build-engine.mjs`는 엔진 SHA-256이 다음 기준값과 일치해야 실행됩니다. 이 예제를 위해 엔진을 수정하지 않았습니다.

```text
00f584ec0799072983f80914929fc7ddf304731be28ab773b0c31fa1f9277659
```

글꼴이 다른 위치에 있다면 `DEMO_FONT_REGULAR`, `DEMO_FONT_BOLD`에 Noto Sans CJK TTC 경로를 지정할 수 있습니다. 다른 글꼴을 쓰거나 라이브러리·FFmpeg 버전이 바뀌면 미디어 해시는 달라질 수 있습니다.

정확한 기존 파일 검증에는 `SHA256SUMS.txt`를 사용합니다. 재생성 후의 기능·순서 검증에는 `--skip-manifest`를 사용하며 원본 해시를 덮어쓰지 않습니다. 중간 검토 이미지는 `.build/` 안에 생성되고 공개 산출물 목록에서 제외합니다.
