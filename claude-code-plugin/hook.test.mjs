import { test, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const hookPath = path.join(here, 'hook.mjs')

const hasBundle = fs.existsSync(hookPath)

function runHook(payload) {
  return execFileSync('node', [hookPath], {
    input: JSON.stringify(payload),
    env: { ...process.env, MD_READER_TERM_CAPS: 'unicode' },
    encoding: 'utf-8',
  })
}

const mindMapJson = JSON.stringify({
  type: 'mind_map',
  tree: {
    id: 'root',
    name: 'Doc Title',
    value: 0,
    children: [
      {
        id: 'a',
        name: 'Section A',
        value: 0,
        children: [{ id: 'a1', name: 'Sub A1', value: 0, children: [] }],
      },
      { id: 'b', name: 'Section B', value: 0, children: [] },
    ],
  },
  source_file: '/x/doc.md',
  browser_url: 'http://localhost:5183/#x',
  total_nodes: 4,
  max_depth: 2,
  section: null,
})

test.runIf(hasBundle)('renders mind_map JSON into updatedToolOutput tree', () => {
  const stdout = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__md-reader__show_mind_map',
    tool_input: { path: 'doc.md' },
    tool_output: { content: [{ type: 'text', text: mindMapJson }] },
  })
  const out = JSON.parse(stdout)
  expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse')
  const text = out.hookSpecificOutput.updatedToolOutput.content[0].text
  expect(text).toMatch(/[├└│]/)
  expect(text).toContain('Section A')
})

test.runIf(hasBundle)('passes non-mind-map text through unchanged', () => {
  const stdout = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__md-reader__show_mind_map',
    tool_output: { content: [{ type: 'text', text: 'not json at all' }] },
  })
  const out = JSON.parse(stdout)
  expect(out.hookSpecificOutput.updatedToolOutput.content[0].text).toBe('not json at all')
})

test.runIf(hasBundle)('emits nothing on unparseable stdin (never blocks the tool)', () => {
  const stdout = execFileSync('node', [hookPath], {
    input: 'this is not json',
    env: { ...process.env, MD_READER_TERM_CAPS: 'unicode' },
    encoding: 'utf-8',
  })
  expect(stdout.trim()).toBe('')
})
