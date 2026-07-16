# Launch Runbook — 1.0.0

Prereqs (one-time, human): npm account with 2FA; repo secret `NPM_TOKEN` (automation token) set; VS Code Marketplace PAT set as repo secret `VSCE_PAT`; Chrome Web Store developer account ($5 fee paid).

(Local-only prep files: `founder-comment.md`, `tweet-variants.md`, `distribution.md`, `hero-gif-storyboard.md` under `docs/launch/` are intentionally untracked — kept locally, not in the public repo.)

## 1. npm — CLI (headline: `npx md-reader`)

```bash
git tag cli-v1.0.0 && git push origin cli-v1.0.0   # release-cli.yml publishes
```

**Name caveat:** `md-reader` was unpublished by a previous owner on 2021-10-20. If the publish job fails with a 403 name-reuse error: (a) file an npm support name dispute (usually granted for names unpublished years ago), or (b) fallback — rename `cli/package.json` to `mdreader` (verify availability first: `npm view mdreader`), keep both bins (`md-reader`, `mdr`), and update the README one-liner. Do NOT launch externally until the README command is verified working end-to-end: `npx md-reader@latest --help` from a machine that has never installed it.

**Bin note:** the `mdr` bin alias collides with the existing npm package `mdr` for global installs. Acceptable; npm warns rather than breaks for npx usage.

## 2. npm — MCP server

```bash
git tag mcp-v1.0.0 && git push origin mcp-v1.0.0   # release-mcp.yml publishes
```

## 3. VS Code Marketplace

```bash
git tag vscode-v1.0.0 && git push origin vscode-v1.0.0   # release-vscode.yml publishes
```

Marketplace listing: verify `vscode-extension/README.md` renders well (it becomes the listing page) and the icon shows.

## 4. Chrome Web Store

```bash
./scripts/pack-browser-extension.sh
```

Upload `dist-extension/md-reader-extension-v1.0.0.zip` at https://chrome.google.com/webstore/devconsole. Listing copy: reuse README tagline + 3 screenshots from `docs/screenshots/`. Review takes ~1–3 days — submit BEFORE the HN/PH date.

## 5. MCP registries

Official registry (after step 2 is live on npm):

```bash
cd mcp-server
brew install mcp-publisher || go install github.com/modelcontextprotocol/registry/cmd/publisher@latest
mcp-publisher login github
mcp-publisher publish   # reads server.json
```

Then submit to aggregators: Smithery (https://smithery.ai), PulseMCP, mcp.so (each has a "submit server" form; point at the GitHub repo + npm package).

## 5b. Claude Code plugin marketplace

The plugin lives at `claude-code-plugin/` (v1.0.0 after this release). Submit per the current claude-plugins marketplace process (PR to the community marketplace repo, or list the repo itself as a marketplace source: `/plugin marketplace add manup-dev/themarkdownreader`). Verify install from a clean session before announcing.

## 6. Show HN

- Title: `Show HN: md-reader – local markdown reader with local-LLM Q&A and mind maps`
  (Alternate: `Show HN: A private, AI-native reader for the markdown your coding agents generate`)
- URL: the GitHub repo (HN convention for Show HN dev tools).
- Post Tue–Thu, 7–10 AM PT. Post the founder comment (docs/launch/founder-comment.md) within 5 minutes.
- First-day rule: answer every comment; concede valid criticism; never argue.

## 7. Product Hunt (2–7 days after HN)

Assets from the June prep. Schedule for 12:01 AM PT; use tweet variants from docs/launch/tweet-variants.md through the day.

## 8. Awesome-list PRs (day after launch, cite the live links)

- https://github.com/mundimark/awesome-markdown (Readers section)
- https://github.com/hesreallyhim/awesome-claude-code (plugin + MCP)
- https://github.com/punkpeye/awesome-mcp-servers
- https://github.com/awesome-selfhosted/awesome-selfhosted (Document Management)

One-line pitch for all: "md-reader — local, private, AI-native markdown reader (mind maps, Q&A, TTS) that works offline; MIT."

## Order of operations

1–5 (publishes + store review lead time) → verify every install command on a clean machine → 6 (HN) → 7 (PH) → 8 (lists).
