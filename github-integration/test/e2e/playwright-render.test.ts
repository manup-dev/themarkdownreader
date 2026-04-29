import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPipeline } from '../../src/index'

const ENABLED = process.env.MDR_GITHUB_E2E === '1'

test.skip(!ENABLED, 'set MDR_GITHUB_E2E=1 to run this test (uses public api.github.com)')

test('GitHub renders the .comments.md companion with the structure we promise', async ({ page, request }) => {
  // 1. Generate a real companion via the pipeline.
  const root = await mkdtemp(join(tmpdir(), 'mdr-pw-'))
  await writeFile(join(root, 'foo.md'), '# F\n\nbody line\n')
  await writeFile(join(root, '.foo.md.annot'),
    JSON.stringify({ v:1, ts: Date.UTC(2026,3,30), id:'c1', op:'comment.add',
      docKey:'d', anchor:{ line:3, text:'body line' },
      selectedText:'body line', body:'pw note', author:'alice', sectionId:'s' }) + '\n')

  await runPipeline({ workspace: root, suffix: '.comments.md', now: Date.UTC(2026,3,30) })
  const companion = await readFile(join(root, 'foo.md.comments.md'), 'utf8')

  // 2. Ask GitHub's public renderer to convert it to the exact HTML they'd show.
  const rendered = await request.post('https://api.github.com/markdown', {
    headers: { Accept: 'application/vnd.github+json' },
    data: { text: companion, mode: 'gfm' },
  })
  expect(rendered.status(), await rendered.text()).toBe(200)
  const html = await rendered.text()

  // 3. Mount the HTML in a Playwright page and assert structural promises.
  await page.setContent(`<article class="markdown-body">${html}</article>`)
  await expect(page.locator('h1')).toContainText('Comments on')
  await expect(page.locator('h3')).toContainText('Line 3')
  await expect(page.locator('a', { hasText: 'Open in source' })).toHaveAttribute('href', /foo\.md#L3/)
})
