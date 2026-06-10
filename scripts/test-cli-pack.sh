#!/usr/bin/env bash
# Smoke test: pack the CLI exactly as npm publish would, install the tarball
# in a clean temp project, and verify the binary serves the built app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT/cli"
TARBALL="$PWD/$(npm pack --silent)"
trap 'rm -f "$TARBALL"' EXIT

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; rm -f "$TARBALL"' EXIT
cd "$TMP"
npm init -y --silent >/dev/null
npm install --silent "$TARBALL"

# 1. --help exits 0 and prints usage
./node_modules/.bin/md-reader --help | grep -q "Usage" || { echo "FAIL: --help"; exit 1; }
./node_modules/.bin/mdr --help >/dev/null || { echo "FAIL: mdr alias"; exit 1; }

# 2. serves the app and the markdown file
echo "# smoke doc" > smoke.md
./node_modules/.bin/md-reader --no-open --port 4199 smoke.md &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$TMP"; rm -f "$TARBALL"' EXIT
sleep 2
curl -sf http://localhost:4199/ | grep -q "md-reader" || { echo "FAIL: app not served"; exit 1; }
echo "PASS: CLI pack smoke"
