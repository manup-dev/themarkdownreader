/**
 * Collection engine — takes a directory of .md files and builds a connected reading graph.
 *
 * Discovers:
 * - Explicit links: [text](./other.md), [[wikilinks]]
 * - Shared concepts: TF-IDF similarity between files
 * - Structure: README as root, numbered files as sequence, directory hierarchy
 * - Reading order: topological sort of link graph, weighted by file position
 */

import { extractToc, wordCount, estimateReadingTime } from './markdown'
import type { TocEntry } from '../store/useStore'

export interface CollectionFile {
  path: string           // relative path within the collection (e.g., "docs/getting-started.md")
  name: string           // display name (e.g., "Getting Started")
  markdown: string
  wordCount: number
  readingTime: number
  toc: TocEntry[]
  linksTo: string[]      // paths this file links to
  linkedFrom: string[]   // paths that link to this file
  depth: number          // directory depth (0 = root)
  order: number          // suggested reading order
}

export interface CollectionLink {
  source: string   // file path
  target: string   // file path
  type: 'explicit' | 'wikilink' | 'similarity'
  label?: string   // link text or shared concept
}

export interface Collection {
  name: string
  files: CollectionFile[]
  links: CollectionLink[]
  rootFile: string | null          // README or index file
  suggestedOrder: string[]         // recommended reading sequence
  totalWords: number
  totalReadingTime: number
  structure: 'sequential' | 'wiki' | 'flat' | 'hierarchical'
}

// ─── Parse a set of files into a Collection ────────────────────────────────

export function buildCollection(
  files: Array<{ path: string; content: string }>,
  collectionName: string,
): Collection {
  const fileMap = new Map(files.map((f) => [normalizePath(f.path), f.content]))
  const allPaths = [...fileMap.keys()]

  // Parse each file
  const parsedFiles: CollectionFile[] = files.map((f) => {
    const path = normalizePath(f.path)
    const links = extractLinks(f.content, allPaths)
    const toc = extractToc(f.content)
    const wc = wordCount(f.content)

    return {
      path,
      name: pathToName(path),
      markdown: f.content,
      wordCount: wc,
      readingTime: estimateReadingTime(f.content),
      toc,
      linksTo: links.map((l) => l.target),
      linkedFrom: [],
      depth: path.split('/').length - 1,
      order: 0,
    }
  })

  // Build backlinks
  for (const file of parsedFiles) {
    for (const target of file.linksTo) {
      const targetFile = parsedFiles.find((f) => f.path === target)
      if (targetFile && !targetFile.linkedFrom.includes(file.path)) {
        targetFile.linkedFrom.push(file.path)
      }
    }
  }

  // Build link objects
  const links: CollectionLink[] = []
  for (const file of parsedFiles) {
    for (const target of file.linksTo) {
      links.push({ source: file.path, target, type: 'explicit' })
    }
  }

  // Add wikilinks
  for (const file of parsedFiles) {
    const wikilinks = extractWikilinks(file.markdown, allPaths)
    for (const wl of wikilinks) {
      if (!links.find((l) => l.source === file.path && l.target === wl.target)) {
        links.push({ source: file.path, target: wl.target, type: 'wikilink', label: wl.label })
      }
      if (!file.linksTo.includes(wl.target)) file.linksTo.push(wl.target)
    }
  }

  // Detect root file
  const rootFile = findRootFile(allPaths)

  // Detect structure
  const structure = detectStructure(parsedFiles, links)

  // Compute reading order
  const suggestedOrder = computeReadingOrder(parsedFiles, links, rootFile, structure)
  parsedFiles.forEach((f) => {
    f.order = suggestedOrder.indexOf(f.path)
  })

  return {
    name: collectionName,
    files: parsedFiles.sort((a, b) => a.order - b.order),
    links,
    rootFile,
    suggestedOrder,
    totalWords: parsedFiles.reduce((s, f) => s + f.wordCount, 0),
    totalReadingTime: parsedFiles.reduce((s, f) => s + f.readingTime, 0),
    structure,
  }
}

// ─── Link extraction ───────────────────────────────────────────────────────

function extractLinks(markdown: string, allPaths: string[]): Array<{ target: string; label: string }> {
  const links: Array<{ target: string; label: string }> = []
  // Match [text](./path.md) or [text](path.md#fragment) or [text](../path.md)
  const regex = /\[([^\]]+)\]\(([^)#]+\.(?:md|markdown))(?:#[^)]*)?\)/g
  let match
  while ((match = regex.exec(markdown)) !== null) {
    const target = normalizePath(match[2])
    // Only include if the target exists in our collection
    const resolved = allPaths.find((p) => p === target || p.endsWith('/' + target) || p.endsWith(target))
    if (resolved) {
      links.push({ target: resolved, label: match[1] })
    }
  }
  return links
}

function extractWikilinks(markdown: string, allPaths: string[]): Array<{ target: string; label: string }> {
  const links: Array<{ target: string; label: string }> = []
  // Match [[filename]] or [[filename|display text]]
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let match
  while ((match = regex.exec(markdown)) !== null) {
    const name = match[1].trim()
    const label = match[2]?.trim() ?? name
    // Find matching file
    const target = allPaths.find((p) => {
      const pName = pathToName(p).toLowerCase()
      return pName === name.toLowerCase() || p.toLowerCase().includes(name.toLowerCase())
    })
    if (target) {
      links.push({ target, label })
    }
  }
  return links
}

// ─── Structure detection ───────────────────────────────────────────────────

function detectStructure(files: CollectionFile[], links: CollectionLink[]): Collection['structure'] {
  const hasNumberedFiles = files.some((f) => /^\d+[-_.]/.test(f.path.split('/').pop() ?? ''))
  const hasManyLinks = links.length > files.length
  const hasDeepDirs = files.some((f) => f.depth > 1)

  // Wiki detection takes priority if there are many inter-file links
  // (even numbered files can be a wiki if they link to each other heavily)
  if (hasManyLinks) return 'wiki'
  if (hasNumberedFiles) return 'sequential'
  if (hasDeepDirs) return 'hierarchical'
  return 'flat'
}

// ─── Reading order computation ─────────────────────────────────────────────

function computeReadingOrder(
  files: CollectionFile[],
  _links: CollectionLink[],
  rootFile: string | null,
  structure: Collection['structure'],
): string[] {
  const paths = files.map((f) => f.path)

  if (structure === 'sequential') {
    // Sort by filename (numbered files: 01-intro, 02-setup, etc.)
    return [...paths].sort((a, b) => {
      const aName = a.split('/').pop() ?? ''
      const bName = b.split('/').pop() ?? ''
      return aName.localeCompare(bName, undefined, { numeric: true })
    })
  }

  // Topological sort from root, with backtrack
  if (rootFile) {
    const visited = new Set<string>()
    const order: string[] = []

    function dfs(path: string) {
      if (visited.has(path)) return
      visited.add(path)
      order.push(path)

      // Follow explicit links in document order
      const file = files.find((f) => f.path === path)
      if (file) {
        for (const target of file.linksTo) {
          if (!visited.has(target)) dfs(target)
        }
      }
    }

    dfs(rootFile)

    // Add any unvisited files at the end
    for (const p of paths) {
      if (!visited.has(p)) order.push(p)
    }

    return order
  }

  // Fallback: alphabetical
  return [...paths].sort()
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/')
}

function pathToName(path: string): string {
  const fileName = path.split('/').pop() ?? path
  const base = fileName.replace(/\.(md|markdown)$/, '')

  // If file has a numeric prefix (e.g., "01-setup"), format as "1. Setup"
  const numMatch = base.match(/^(\d+)[-_.](.+)/)
  if (numMatch) {
    const num = parseInt(numMatch[1], 10)
    const rest = numMatch[2]
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return `${num}. ${rest}`
  }

  // No numeric prefix — just title-case
  return base
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function findRootFile(paths: string[]): string | null {
  // Priority: README.md > index.md > 00-* > 01-* > first file
  const priority = [
    (p: string) => /readme\.md$/i.test(p),
    (p: string) => /index\.md$/i.test(p),
    (p: string) => /^(\.\/)?00[-_.]/.test(p.split('/').pop() ?? ''),
    (p: string) => /^(\.\/)?01[-_.]/.test(p.split('/').pop() ?? ''),
  ]

  for (const test of priority) {
    const found = paths.find(test)
    if (found) return found
  }

  return paths[0] ?? null
}
