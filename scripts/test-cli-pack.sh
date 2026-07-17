#!/usr/bin/env bash
# Smoke test: pack the CLI exactly as npm publish would, install the tarball
# in a clean temp project, and verify the binary serves the built app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARBALL=""; TMP=""; SERVER=""
cleanup() { [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; [ -n "$TMP" ] && rm -rf "$TMP"; [ -n "$TARBALL" ] && rm -f "$TARBALL"; }
trap cleanup EXIT

cd "$ROOT/cli"
TARBALL="$PWD/$(npm pack --silent)"
TMP=$(mktemp -d)
cd "$TMP"
npm init -y --silent >/dev/null
npm install --quiet "$TARBALL"

# 1. --help exits 0 and prints usage
./node_modules/.bin/md-reader --help | grep -q "Usage" || { echo "FAIL: --help"; exit 1; }
./node_modules/.bin/mdr --help >/dev/null || { echo "FAIL: mdr alias"; exit 1; }

# 2. serves the app and the markdown file
SENTINEL="MDR_CLI_PACK_SENTINEL_$$_$(date +%s)"
echo "# smoke doc $SENTINEL" > smoke.md
./node_modules/.bin/md-reader --no-open --port 4199 smoke.md &
SERVER=$!

for i in $(seq 1 10); do
  curl -sf http://localhost:4199/ >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf http://localhost:4199/ | grep -q "md-reader" || { echo "FAIL: app not served"; exit 1; }
curl -sf http://localhost:4199/__cli__/content | grep -q "$SENTINEL" || { echo "FAIL: file content not served via /__cli__/content"; exit 1; }

# 3. stdin pipe mode serves piped content
kill "$SERVER" 2>/dev/null; SERVER=""
echo "# piped smoke doc PIPED_$SENTINEL" | ./node_modules/.bin/md-reader --no-open --port 4198 &
SERVER=$!
for i in $(seq 1 10); do
  curl -sf http://localhost:4198/ >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf http://localhost:4198/ | grep -q "md-reader" || { echo "FAIL: stdin mode not served"; exit 1; }
curl -sf http://localhost:4198/__cli__/content | grep -q "PIPED_$SENTINEL" || { echo "FAIL: piped content not served via /__cli__/content"; exit 1; }

echo "PASS: CLI pack smoke"
