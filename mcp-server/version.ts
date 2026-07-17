import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Resolve this package's version from its own package.json — single source
 * of truth (C3). Works from both the TS source (mcp-server/version.ts, run
 * via tsx) and the esbuild bundle (mcp-server/dist/index.js — package.json
 * is one level up; npm always includes package.json in the published tarball).
 */
export function readOwnVersion(
  fromDir: string = path.dirname(fileURLToPath(import.meta.url))
): string {
  for (const candidate of [path.join(fromDir, 'package.json'), path.join(fromDir, '..', 'package.json')]) {
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as { name?: string; version?: string }
      if (pkg.name === 'md-reader-mcp' && pkg.version) return pkg.version
    }
  }
  return '0.0.0'
}
