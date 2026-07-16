#!/usr/bin/env bash
# Produce the Chrome Web Store upload zip for the browser extension.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/browser-extension/manifest.json').version")
OUT="$ROOT/dist-extension"
mkdir -p "$OUT"
cd "$ROOT/browser-extension"
zip -r "$OUT/md-reader-extension-v$VERSION.zip" . -x '*.DS_Store' -x '*test*'
echo "Wrote $OUT/md-reader-extension-v$VERSION.zip"
