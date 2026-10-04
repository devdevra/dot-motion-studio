# Dot Motion Studio

A Sites-hosted PNG sprite workbench and authenticated MCP server. The user-facing interface is in Korean. This is an original deterministic implementation inspired by the general image-to-sprite workflow, **not** a full installation, fork, or compatibility build of aldegad/sprite-gen.

## Features

- PNG inspection, explicit equal-grid or rectangle extraction
- Alpha threshold cleanup, transparent canvas normalization, center/bottom alignment
- Constant integer 2D translation from a single frame
- Transparent PNG atlas, frame JSON and individual PNG sequence ZIP
- Browser canvas preview; no server file storage
- MCP tools: `motion_capabilities`, `inspect_png`, `build_sprite`

## Safety and privacy

Sites manages authentication and OAuth. Data-bearing API/MCP calls require the trusted `oai-authenticated-user-id` header at the hosting boundary. Discovery contains no private data. The application has no URL-fetch feature, shell runner, API keys, AI generation providers, account-token access, or persistent user-file store. It never reads credentials or session logs. Do not deploy the routes outside the trusted Sites boundary without equivalent authentication and header sanitization.

Input is limited to 2 MB and 1 million pixels, maximum 64 frames, and combined output frame/atlas pixel budgets of 1 million. Processing is in-memory with checked PNG inflation. No R2/D1 bindings are used because results are intentionally request-scoped. Users must download exports before refreshing the page.

The tool does not perform semantic background removal, invented character animation, optical-flow interpolation, 3D motion, motion capture, or video export. Alpha thresholding cannot remove an opaque drawn background. Translation loops reset at the end and are not automatically seamless. Trimming each frame may change an intentional shared anchor; disable trim for already aligned sheets.

## Development

Use Node >=22.13 and the lockfile:

```
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The Sites starter owns the Cloudflare Worker output, publishing and source provenance. `.openai/hosting.json` identifies this Site; preserve its identity on updates. No `.env` values or credentials should be committed.

The reusable Dot Motion skill is included under `skills/dot-motion` as source documentation. It is registered separately in the user's personal skills because canonical Sites plugin archives cannot currently be edited to add skills.

## Source and licensing

All motion-engine and application code for this project is original. No code from sprite-gen is bundled or executed. Third-party npm dependency licenses remain with their respective packages and are listed in `THIRD_PARTY.md`. No license grant is made for this project's original code.

The Site UI is public. Image processing still requires a trusted signed-in ChatGPT user. No user uploads or exports are stored or listed, and making the Site public does not change the canonical plugin’s separate installation/access state.
