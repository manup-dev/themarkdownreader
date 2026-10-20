import { describe, it, expect, afterEach, vi } from 'vitest'
import { openDirectory, readFileList } from '../lib/fs-access'
import { useStore, folderKeyOf } from '../store/useStore'

// Browsers without showDirectoryPicker (Firefox, Safari, Brave) must still be
// able to open a folder via <input webkitdirectory>. Regression: the fallback
// was never wired up, so "Open Folder" dead-ended on an empty collection view.

function makeFile(relPath: string, text: string): File {
  const f = new File([text], relPath.split('/').pop()!, { lastModified: 1000 })
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath })
  return f
}

function asFileList(files: File[]): FileList {
  return Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList
}

describe('readFileList', () => {
  it('strips the picked folder name and keeps nested paths', async () => {
    const files = await readFileList(asFileList([
      makeFile('notes/a.md', '# A'),
      makeFile('notes/sub/c.markdown', '# C'),
    ]))
    expect(files.map((f) => f.path)).toEqual(['a.md', 'sub/c.markdown'])
    expect(files[0].content).toBe('# A')
  })

  it('skips non-markdown files and hidden/node_modules/dist directories', async () => {
    const files = await readFileList(asFileList([
      makeFile('notes/readme.md', 'x'),
      makeFile('notes/image.png', 'x'),
      makeFile('notes/.git/HEAD.md', 'x'),
      makeFile('notes/node_modules/pkg/README.md', 'x'),
      makeFile('notes/dist/out.md', 'x'),
    ]))
    expect(files.map((f) => f.path)).toEqual(['readme.md'])
  })
})

describe('openDirectory without showDirectoryPicker', () => {
  afterEach(() => vi.restoreAllMocks())

  function stubInputClick(onClick: (input: HTMLInputElement) => void) {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      onClick(this)
    })
  }

  it('falls back to a webkitdirectory input and returns files with a null handle', async () => {
    expect('showDirectoryPicker' in window).toBe(false)
    stubInputClick((input) => {
      expect(input.webkitdirectory).toBe(true)
      Object.defineProperty(input, 'files', { value: asFileList([makeFile('notes/a.md', '# A')]) })
      input.dispatchEvent(new Event('change'))
    })
    const result = await openDirectory()
    expect(result).toEqual({
      name: 'notes',
      handle: null,
      files: [{ path: 'a.md', content: '# A', lastModified: 1000 }],
    })
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('resolves null when the user cancels the picker', async () => {
    stubInputClick((input) => input.dispatchEvent(new Event('cancel')))
    expect(await openDirectory()).toBeNull()
    expect(document.querySelector('input[type=file]')).toBeNull()
  })
})

describe('setFolderSession for handle-less folders', () => {
  it('uses the picked folder name so different folders get their own tabs', () => {
    useStore.setState({ tabs: [], activeTabId: null, folderHandle: null })
    const file = (path: string) => ({ path, name: path, content: `# ${path}` })

    useStore.getState().setFolderSession(null, [file('a.md')], 'notes')
    expect(folderKeyOf(useStore.getState())).toBe('notes')

    useStore.getState().setFolderSession(null, [file('x.md')], 'journal')
    const { tabs } = useStore.getState()
    expect(tabs.filter((t) => t.kind === 'folder').map((t) => t.folderName)).toEqual(['notes', 'journal'])
    expect(folderKeyOf(useStore.getState())).toBe('journal')
    expect(useStore.getState().activeFilePath).toBe('x.md')
  })
})
