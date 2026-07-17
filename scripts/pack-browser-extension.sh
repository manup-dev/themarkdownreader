#!/usr/bin/env bash
# Produce the Chrome Web Store upload zip for the browser extension.
# Delegates to browser-extension/build-zip.sh — the single curated runtime
# file list — then moves the artifact into dist-extension/ for the runbook.
# (C9: the old `zip -r .` shipped README/build scripts/screenshots, and
# zip -r UPDATES an existing archive in place, so stale zips are deleted.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/browser-extension/manifest.json').version")
OUT="$ROOT/dist-extension"
ZIP="md-reader-extension-v$VERSION.zip"
mkdir -p "$OUT"
rm -f "$OUT/$ZIP"
bash "$ROOT/browser-extension/build-zip.sh"
mv "$ROOT/browser-extension/$ZIP" "$OUT/$ZIP"
echo "Wrote $OUT/$ZIP"
unzip -l "$OUT/$ZIP"
