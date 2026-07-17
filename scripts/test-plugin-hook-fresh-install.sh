#!/usr/bin/env bash
# C1 regression gate: the plugin's PostToolUse hook must work from a fresh
# plugin install — i.e. from ONLY the git-tracked plugin files, with no
# node_modules anywhere up the directory tree (mktemp -d is outside the repo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Copy exactly the git-tracked plugin files from the working tree.
git -C "$ROOT" ls-files -z claude-code-plugin | tar -c -C "$ROOT" --null -T - | tar -x -C "$TMP"
cd "$TMP/claude-code-plugin"
[ -d node_modules ] && { echo "FAIL: node_modules leaked into the fresh tree"; exit 1; }

PAYLOAD='{"tool_name":"mcp__md-reader__show_mind_map","tool_output":{"content":[{"type":"text","text":"{\"type\":\"mind_map\",\"tree\":{\"id\":\"r\",\"name\":\"Doc\",\"value\":0,\"children\":[{\"id\":\"a\",\"name\":\"Section A\",\"value\":0,\"children\":[]}]},\"source_file\":\"/x/doc.md\",\"browser_url\":\"http://x\",\"total_nodes\":2,\"max_depth\":1,\"section\":null}"}]}}'

OUT="$(echo "$PAYLOAD" | MD_READER_TERM_CAPS=unicode node hook.mjs)"
echo "$OUT" | grep -q 'updatedToolOutput' || { echo "FAIL: no updatedToolOutput"; echo "$OUT"; exit 1; }
echo "$OUT" | grep -q 'Section A'         || { echo "FAIL: tree not rendered"; echo "$OUT"; exit 1; }

# Image-capable caps exercise the bundled markmap-lib branch. sharp is absent
# in a fresh tree — the hook must fall back to ASCII, not crash.
OUT2="$(echo "$PAYLOAD" | MD_READER_TERM_CAPS=kitty,unicode node hook.mjs)"
echo "$OUT2" | grep -q 'Section A' || { echo "FAIL: image-caps path crashed"; echo "$OUT2"; exit 1; }

echo "PASS: hook runs from git-tracked files only (no node_modules)"
