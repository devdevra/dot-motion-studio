#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 prepare-source.py
node build-engine.mjs
python3 render-video.py
python3 verify-media.py
sha256sum -c SHA256SUMS.txt
