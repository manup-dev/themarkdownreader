import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { readOwnVersion } from './version'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf-8')) as { version: string }

describe('readOwnVersion', () => {
  it('matches package.json version (single source of truth, C3)', () => {
    expect(readOwnVersion()).toBe(pkg.version)
    expect(readOwnVersion()).not.toBe('0.0.0')
  })

  it('resolves package.json one level up (dist/index.js case)', () => {
    expect(readOwnVersion(path.join(here, 'dist'))).toBe(pkg.version)
  })

  it('returns the 0.0.0 sentinel when no md-reader-mcp package.json is found', () => {
    expect(readOwnVersion('/nonexistent-dir-for-version-test')).toBe('0.0.0')
  })
})
