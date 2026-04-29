import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, rmSync, cpSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_SRC = join(HERE, 'fixture-repo')
const PKG_ROOT = resolve(HERE, '..', '..')

const HAS_ACT = (() => {
  const r = spawnSync('act', ['--version'], { stdio: 'ignore' })
  return r.status === 0
})()

describe.skipIf(!HAS_ACT)('act-driven workflow run', () => {
  it('runs the Action against the fixture repo and writes the expected companion', () => {
    // Stage the fixture into a tmp dir so the test never mutates the source fixture.
    const stage = join(tmpdir(), `mdr-act-${Date.now()}`)
    mkdirSync(stage, { recursive: true })
    cpSync(FIXTURE_SRC, stage, { recursive: true })

    // The fixture's workflow uses `uses: ./`, meaning act expects an action.yml
    // at the workflow's checkout root. Symlink the package root into the staged
    // fixture so `./` resolves to our action.yml + dist/index.js.
    const actionLink = join(stage, 'action.yml')
    const distLink = join(stage, 'dist')
    try { rmSync(actionLink, { force: true }) } catch {}
    try { rmSync(distLink, { force: true, recursive: true }) } catch {}
    symlinkSync(join(PKG_ROOT, 'action.yml'), actionLink)
    symlinkSync(join(PKG_ROOT, 'dist'), distLink)

    // Need a git repo so checkout@v4 has something to clone-ish.
    spawnSync('git', ['init', '-q'], { cwd: stage })
    spawnSync('git', ['add', '-A'], { cwd: stage })
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: stage })

    const result = spawnSync('act', [
      'push',
      '-W', '.github/workflows/render.yml',
      '--bind',
    ], { cwd: stage, encoding: 'utf8' })

    if (result.status !== 0) {
      // Surface stderr so we can debug act runner issues.
      throw new Error(`act failed (status=${result.status}):\n${result.stderr}\n${result.stdout}`)
    }

    const outPath = join(stage, 'foo.md.comments.md')
    expect(existsSync(outPath), 'companion not written').toBe(true)
    const out = readFileSync(outPath, 'utf8')
    expect(out).toContain('# Comments on `foo.md`')
    expect(out).toContain('Citation needed.')
    expect(out).toContain('<details>')
    expect(out).toContain('Resolved · Line 3')
  }, 180_000)
})
