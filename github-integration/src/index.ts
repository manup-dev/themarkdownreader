import * as core from '@actions/core'
import { readFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { findSidecars } from './discover'
import { decodeWal, materialize } from './parser'
import { renderCommentsMarkdown } from './render'
import { writeOutputsIfChanged, type OutputFile } from './apply'

export interface PipelineOptions {
  workspace: string
  suffix: string
}

export interface PipelineResult {
  processed: number
  changed: string[]
  skipped: number
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { suffix } = opts
  if (suffix.length === 0 || /[\\/]/.test(suffix) || suffix.includes('..') || suffix.includes('\0')) {
    throw new Error(`invalid suffix: ${JSON.stringify(suffix)} — must be a plain filename suffix without separators or ".."`)
  }
  const pairs = await findSidecars(opts.workspace)
  const outputs: OutputFile[] = []
  let skipped = 0
  for (const { sourcePath, sidecarPath } of pairs) {
    try {
      const [walText, sourceText] = await Promise.all([
        readFile(sidecarPath, 'utf8'),
        readFile(sourcePath, 'utf8'),
      ])
      const events = decodeWal(walText)
      const state = materialize(events)
      // The link inside the rendered companion only needs the basename — the
      // companion sits next to its source, so a relative same-dir link works.
      const sourceRel = relative(dirname(sourcePath), sourcePath)
      const rendered = renderCommentsMarkdown(state, sourceRel, sourceText)
      outputs.push({ path: sourcePath + opts.suffix, content: rendered })
    } catch (err) {
      skipped++
      const msg = err instanceof Error ? err.message : String(err)
      core.warning(`md-reader: skipped ${sidecarPath} — ${msg}`)
    }
  }
  const changed = await writeOutputsIfChanged(outputs)
  return { processed: pairs.length, changed, skipped }
}

async function run(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
  const suffix = core.getInput('suffix') || '.comments.md'
  const result = await runPipeline({ workspace, suffix })
  core.setOutput('processed', String(result.processed))
  core.setOutput('changed', result.changed.join('\n'))
  core.setOutput('changed_count', String(result.changed.length))
  core.info(`md-reader: processed ${result.processed} sidecar(s), ${result.changed.length} file(s) changed, ${result.skipped} skipped.`)
}

// Only auto-run when invoked as the Actions entrypoint, not when imported by tests.
if (process.env.GITHUB_ACTIONS === 'true') {
  run().catch((err) => {
    core.setFailed(err instanceof Error ? err.message : String(err))
  })
}
