# @md-reader/github-integration

> Make md-reader annotations readable on github.com — no extension, no Pages site, no install for viewers.

## What this does

When your team writes highlights and comments on markdown docs in [md-reader](https://github.com/manup-dev/themarkdownreader), the data is stored in a small JSONL sidecar named `.foo.md.annot` next to each `foo.md`. This action reads every paired sidecar in your repo on push and emits a sibling `foo.md.comments.md` companion that GitHub renders natively. Reviewers can browse comments inline on github.com — file browser, blame, mobile, raw — without installing the md-reader reader, the browser extension, or anything else. Resolved comments collapse into `<details>` blocks; unanchored comments still show but without line links.

## Why this exists

Three obvious ways to surface md-reader annotations to a github.com viewer, and we picked the one with the least friction:

| Surface | Install required for viewer | Works on every push | Visible where on github.com | Auth surface |
|---|---|---|---|---|
| **This Action (committed companion)** | none | yes | file browser, blame, mobile, raw, blob | `contents: write` only |
| Browser extension | install per viewer | n/a | wherever the extension injects | none, but each viewer must opt in |
| PR review comments | none | PR-only | PR conversation tab | `pull-requests: write` |

A future opt-in flag will add the PR-review-comment path on top of the same parser. The committed companion is the default because it's visible everywhere on github.com without ceremony.

## Quick start

Drop this in `.github/workflows/render-annotations.yml`:

```yaml
name: Render annotations
on: { push: { paths: ['**/*.md', '**/.*.md.annot'] } }
permissions: { contents: write }
jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: render
        uses: manup-dev/themarkdownreader/github-integration@v1
      - if: steps.render.outputs.changed_count != '0'
        uses: stefanzweifel/git-auto-commit-action@v5
        with: { commit_message: 'chore: refresh annotation companions' }
```

Push a `.foo.md.annot` next to a `foo.md`, watch the workflow run, then click `foo.md.comments.md` in the file browser.

## How to test it against real GitHub

Three escalating recipes. Start at the lowest cost.

### 1. Offline with `act` (recommended for development)

[`act`](https://github.com/nektos/act) runs GitHub workflows on your laptop in Docker. From a checkout of *this* repo:

```bash
cp -r github-integration/examples/test-fixture /tmp/mdr-fixture
cd /tmp/mdr-fixture
git init -q && git add -A && git commit -qm "fixture"
act push -W .github/workflows/render.yml --bind
ls foo.md.comments.md   # ← should now exist
cat foo.md.comments.md  # ← inspect the rendered output
```

`--bind` writes back into your working tree so you can inspect the rendered companion. The fixture is the same one the test suite uses; if it works for `act`, it'll work for github.com.

### 2. Fork-and-push (real GitHub, your account)

1. Fork [`manup-dev/themarkdownreader`](https://github.com/manup-dev/themarkdownreader) into your account.
2. Edit any `.md` in your fork and create a `.{name}.md.annot` next to it (use md-reader to generate it, or paste a fixture from `github-integration/test/e2e/fixture-repo/.foo.md.annot`).
3. Add `.github/workflows/render-annotations.yml` from the Quick Start above.
4. Push. Open the **Actions** tab. After the run completes, the companion appears in your fork as a new commit. Click `{name}.md.comments.md` to see github.com render it.

### 3. `workflow_dispatch` smoke (manual trigger on a real repo)

If you don't want to depend on `paths:` triggers while iterating, swap the `on:` block:

```yaml
on:
  workflow_dispatch:
```

Trigger from the Actions tab → "Run workflow" → confirm. The job runs; verify outputs in the run summary (`processed`, `changed`, `changed_count`).

If something fails, the Action surfaces those three outputs so you can gate downstream steps on them.

### Bonus: render preview without GitHub

The Playwright-based test (`test/e2e/playwright-render.test.ts`) generates a companion locally and POSTs it to GitHub's public `POST /markdown` endpoint, then loads the returned HTML in a headless browser. This is the only way to *prove* the output looks right when github.com renders it without actually pushing. Run it with:

```bash
cd github-integration
npm install
npx playwright install chromium
MDR_GITHUB_E2E=1 npm run test:e2e:playwright
```

It's gated behind `MDR_GITHUB_E2E=1` because anonymous calls to api.github.com are rate-limited (60/hour) — fine for development, but we don't want it running in tight CI loops.

## Concurrency

If your repo can have multiple workflow runs touching the same branch (e.g., rapid pushes), wrap the workflow in a concurrency group so commits don't race:

```yaml
concurrency:
  group: render-${{ github.ref }}
  cancel-in-progress: false
```

## Inputs

| Name | Default | Description |
|---|---|---|
| `suffix` | `.comments.md` | Suffix appended to each source filename to form the companion path. |

## Outputs

| Name | Description |
|---|---|
| `processed` | Number of sidecars processed. |
| `changed` | Newline-separated list of companion files written or deleted. |
| `changed_count` | Length of the changed list (handy for `if:` gates). |
| `skipped` | Number of sidecars skipped due to read or parse errors. Use to gate alerts. |

## Permissions

`contents: write` is sufficient *and* required if you commit the rendered output back. The Action itself never makes API calls — it only reads and writes files in `GITHUB_WORKSPACE`.

## FAQ

**Q: I have highlights without comments — where do they show up?**
They don't, by design. Highlights without prose carry no review value on github.com (color isn't visible in the rendered companion); only `comment.add` events are surfaced. If you want highlight-with-note rendering, file an issue.

**Q: I have `.annot` files I don't want rendered (e.g., archived docs).**
Tighten the workflow's `paths:` filter to skip those directories, or rename the sidecar — anything not matching `.<stem>.annot` is ignored.

**Q: How do I test before pushing?**
Use the `act` recipe above, or import `runPipeline` from `dist/index.js` in a Node REPL.

**Q: Why isn't this a GitHub App?**
Apps add OAuth complexity and a marketplace listing for the same outcome. The Action ships today, can be wrapped by an App later, and uses zero external services.

**Q: I clicked "Open in source" in the rendered companion and it didn't scroll anywhere.**
GitHub strips fragment identifiers (`#L9`) from links inside rendered markdown previews. The link works correctly when you click it from the **blob view** of the companion (use the "Code" tab → click the file → the rendered view shows the link, then click "Raw" or "Blame" to navigate the markdown source which preserves the anchor). On mobile and in PR diff views, anchors also resolve. We render the anchor anyway because it's load-bearing in every other surface; the only loss is the rendered-preview view.

**Q: What's the parser source of truth?**
The `.annot` JSONL grammar lives in the main md-reader repo at `src/lib/annotation-events.ts`. This package vendors a copy at `src/lib/annotation-events.ts` so it can typecheck cleanly without inheriting the parent's DOM-typed transitive imports. Keep them in sync.

## License

MIT — same as the main md-reader project.
