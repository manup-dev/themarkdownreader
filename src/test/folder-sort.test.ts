import { describe, it, expect } from 'vitest'
import { sortFolderFiles } from '../lib/folder-sort'

/**
 * Pins natural-sort behavior for the folder sidebar. The underlying bug:
 * File System Access API returns files in an arbitrary order (often not
 * alphabetical), so a folder like `00-intro.md`, `07-setup.md`, `08-notes.md`
 * previously rendered in an unpredictable order.
 */
describe('sortFolderFiles', () => {
  const make = (name: string, lastModified = 0) => ({ path: name, name, lastModified })

  it('name-asc uses numeric-aware ordering (08 after 07, not after 10)', () => {
    const files = [make('10-advanced.md'), make('08-notes.md'), make('00-intro.md'), make('07-setup.md')]
    const sorted = sortFolderFiles(files, 'name-asc').map(f => f.name)
    expect(sorted).toEqual(['00-intro.md', '07-setup.md', '08-notes.md', '10-advanced.md'])
  })

  it('name-asc handles mixed alpha + numeric names case-insensitively', () => {
    const files = [make('Zoo.md'), make('apple.md'), make('02-bee.md'), make('Banana.md')]
    const sorted = sortFolderFiles(files, 'name-asc').map(f => f.name)
    // Numeric-prefixed files sort before alpha under {numeric: true}; alpha
    // portion is case-insensitive (sensitivity: 'base').
    expect(sorted[0]).toBe('02-bee.md')
    expect(sorted.slice(1)).toEqual(['apple.md', 'Banana.md', 'Zoo.md'])
  })

  it('name-desc reverses the natural order', () => {
    const files = [make('00-a.md'), make('10-b.md'), make('02-c.md')]
    const sorted = sortFolderFiles(files, 'name-desc').map(f => f.name)
    expect(sorted).toEqual(['10-b.md', '02-c.md', '00-a.md'])
  })

  it('mtime-desc returns newest first', () => {
    const files = [make('old.md', 100), make('newer.md', 300), make('middle.md', 200)]
    const sorted = sortFolderFiles(files, 'mtime-desc').map(f => f.name)
    expect(sorted).toEqual(['newer.md', 'middle.md', 'old.md'])
  })

  it('mtime-asc returns oldest first', () => {
    const files = [make('old.md', 100), make('newer.md', 300), make('middle.md', 200)]
    const sorted = sortFolderFiles(files, 'mtime-asc').map(f => f.name)
    expect(sorted).toEqual(['old.md', 'middle.md', 'newer.md'])
  })

  it('does not mutate the input array', () => {
    const files = [make('b.md'), make('a.md')]
    const original = files.slice()
    sortFolderFiles(files, 'name-asc')
    expect(files).toEqual(original)
  })

  it('treats missing lastModified as 0 for mtime sort', () => {
    const files = [
      { path: 'a.md', name: 'a.md', lastModified: 0 },
      { path: 'b.md', name: 'b.md', lastModified: 500 },
    ]
    const sorted = sortFolderFiles(files, 'mtime-desc').map(f => f.name)
    expect(sorted).toEqual(['b.md', 'a.md'])
  })
})
