#!/usr/bin/env bash
# Build the Chrome Web Store upload zip. Includes only runtime files —
# the Web Store inflates review time on zips carrying docs/screenshots.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('./manifest.json').version")
OUT="md-reader-extension-v${VERSION}.zip"
rm -f "$OUT"
zip -r "$OUT" \
  manifest.json popup.html popup.js icon48.png icon128.png \
  content.js content.css markmap-bundle.js
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT"
