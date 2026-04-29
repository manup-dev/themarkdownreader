import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface OutputFile {
  path: string
  /** Empty string means "remove the file if it exists". */
  content: string
}

/**
 * Write each output only when its content differs from disk. Returns the list
 * of paths that were actually changed (created, updated, or deleted), so the
 * caller can decide whether to commit.
 */
export async function writeOutputsIfChanged(outputs: OutputFile[]): Promise<string[]> {
  const changed: string[] = []
  for (const { path, content } of outputs) {
    const existing = await readSafely(path)
    if (content === '') {
      if (existing !== null) {
        await unlink(path)
        changed.push(path)
      }
      continue
    }
    if (existing === content) continue
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
    changed.push(path)
  }
  return changed
}

async function readSafely(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
