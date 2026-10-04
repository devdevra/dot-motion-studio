---
name: dot-motion
description: PNG 스프라이트 시트 분리, 알파 임계값 정리, 프레임 정렬, 아틀라스·PNG 시퀀스와 간단한 2D 이동 제작. Dot Motion Studio 사용, sprite sheet 프레임 추출, 투명 PNG 프레임 내보내기 요청에 사용한다. 일반 사진 편집이나 AI 캐릭터 동작 생성에는 사용하지 않는다.
---

# Dot Motion

Use Dot Motion Studio for deterministic sprite preparation and constant 2D translation. This is an independent tool, not the full sprite-gen package.

## Choose the route

1. Read [the workflow and limits](references/workflow.md).
2. Prefer the connected Dot Motion Studio MCP tools. Call `motion_capabilities` first to confirm actual availability and supported limits.
3. If the plugin is not connected, offer its canonical Sites plugin installation with the supported plugin setup flow. Do not add local MCP configuration or request API keys. The Studio can also be used directly.
4. Use only an image uploaded or otherwise authorized by the user for this task. Never substitute images from their Library or other accounts without task relevance and authorization.

## Build

- Inspect dimensions and transparency with `inspect_png` before choosing options.
- For a sheet, get an explicit grid or pixel rectangles. Infer a grid only when its layout is unambiguous, state that assumption, and inspect the result. Do not infer character poses from a single image.
- Preserve existing alpha. Alpha threshold cleanup removes only pixels that already have alpha at or below the threshold; it does not recognize backgrounds. Use the regular image-generation/editing workflow for semantic background removal or creation of new poses when the user requests those edits.
- Use `build_sprite` with conservative dimensions. A motion request here means constant integer X/Y translation of one frame. Set FPS explicitly when specified; otherwise use 12 FPS and label it.
- Preserve the intended anchor across frames. Use `trim:false` when sheet cells already share an intentional fixed canvas. Independent trimming and centering can alter animation alignment; inspect first. Prefer bottom alignment only when a shared ground line is appropriate.
- Request `includeSequenceZip:true` only when individual frames are needed. Atlas PNG and JSON metadata are the normal compact output.
- Check output frame count, dimensions, transparency, order, and first/last-frame behavior. Translation loops may jump from the last frame back to the first; do not claim seamless looping without checking.
- Save and deliver requested output as native file attachments. PNG does not carry animation timing; provide the accompanying JSON. Results are ephemeral and must be downloaded/saved before ending the workflow.

## Boundaries

No paid generation service, arbitrary remote URL fetch, local shell execution, credential handling, or session-log access is part of this workflow. Do not install upstream executables as a fallback. Never promise transparent MP4, optical-flow interpolation, 3D motion, or motion capture. If a limit blocks the result, reduce the authorized dimensions/frame count or ask which constraint to prioritize.
