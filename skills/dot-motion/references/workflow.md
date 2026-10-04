# Studio workflow

Studio: https://dot-motion-studio.jakeshin.chatgpt.site

Install or connect the Site's canonical plugin through the available plugin setup UI. Installation and connection are distinct from Site publication. If setup cannot be shown, open Plugins → Personal → Created by you and locate Dot Motion Studio. Never claim it is connected until a tool call succeeds.

## Inputs and exports

Provide PNG bytes as standard base64, without a data URL prefix. Never supply filesystem paths, arbitrary URLs, or credentials. Processing is request-scoped and the app does not persist images or exports.

Inputs: at most 2 MB and 1 million pixels. Frames: at most 64. Combined sequence/atlas pixels: at most 1 million. Actual tool capabilities are authoritative if updated.

Exports: transparent PNG atlas, JSON frame rectangles and millisecond timing, optional ZIP of individually numbered PNGs. An HTML canvas preview loops locally. No video export is provided.

## Options

- `source:{kind:"single"}` keeps a single image
- `source:{kind:"grid",columns:4,rows:2,count:8}` cuts an explicit equal grid
- `source:{kind:"rects",rects:[{x:0,y:0,width:32,height:32}]}` cuts explicit bounds
- `alphaThreshold:0` keeps nonzero alpha and clears fully transparent RGB
- `normalize:{padding:8,align:"center",trim:false}` keeps intentional cell alignment
- `motion:{frames:12,dx:2,dy:0}` shifts one source by 2 pixels on X per frame and expands the canvas
- `fps:12` sets preview/JSON timing
- `atlasColumns` controls atlas layout

Choose safe ASCII output names. The app rejects unsupported fields, oversized input, decompression overrun, invalid dimensions, and out-of-bounds rectangles. Do not retry unchanged invalid inputs.

Example request: “이 4×2 시트를 원래 셀 정렬 그대로 12 FPS로 나눠서 PNG 아틀라스와 JSON으로 줘.” Use grid 4×2, count 8, trim false, and no motion.

Example request: “이 투명 PNG를 오른쪽으로 매 프레임 2픽셀씩 12프레임 이동시켜 줘.” Use one source and the explicit translation. Explain that the preview loop resets after the last frame.
