// Commands registered by the md-reader plugin. Exposed as a single
// `registerCommands` function so plugin.ts can wire them in one place,
// keeping the activator readable.

import type { JupyterFrontEnd } from '@jupyterlab/application'
import type { WidgetTracker } from '@jupyterlab/apputils'
import type { ITranslator } from '@jupyterlab/translation'
import { mdReaderIcon } from './icons'
import type { MdReaderDocumentWidget } from './widgets/MdReaderDocumentWidget'
import type { MdReaderCompanionPanel } from './widgets/CompanionPanel'

const DEBUG =
  typeof globalThis !== 'undefined' &&
  (globalThis as Record<string, unknown>).MDR_DEBUG === true

/** Best-effort grab of the currently-selected path in the file browser.
 *  We deliberately avoid taking a hard dep on @jupyterlab/filebrowser by
 *  reading the DOM — JL's title attribute on a selected `<li>` always
 *  starts with `Name: <filename>` on the first line. We combine that
 *  filename with the current breadcrumb path from `.jp-BreadCrumbs` to
 *  build the workspace-relative path. */
function getSelectedFileBrowserPath(): string | null {
  const el = document.querySelector<HTMLLIElement>(
    '.jp-DirListing-item.jp-mod-selected',
  )
  if (!el) return null
  // 1. Try a directly-attached data-path (some JL forks add this).
  const direct = el.getAttribute('data-path')
  if (direct && !direct.includes('\n')) return direct
  // 2. Pull `Name: <filename>` out of the title attribute.
  const title = el.getAttribute('title') ?? ''
  const m = /^Name:\s*(.+)$/m.exec(title)
  if (!m) return null
  const filename = m[1].trim()
  // 3. Combine with breadcrumb-derived directory (best-effort).
  const crumbs = Array.from(
    document.querySelectorAll<HTMLElement>('.jp-FileBrowser-crumbs .jp-BreadCrumbs-item'),
  )
    .map(c => (c.textContent ?? '').trim())
    .filter(c => c && c !== '/')
  const dir = crumbs.join('/').replace(/^\/?/, '')
  return dir ? `${dir}/${filename}` : filename
}

export const CommandIds = {
  open: 'md-reader:open',
  toggleCompanion: 'md-reader:toggle-companion',
  openSettings: 'md-reader:open-settings',
} as const

const FACTORY_NAME = 'md-reader'

export function registerCommands(opts: {
  app: JupyterFrontEnd
  tracker: WidgetTracker<MdReaderDocumentWidget>
  companion: MdReaderCompanionPanel
  translator?: ITranslator
}): void {
  const { app, companion, translator } = opts
  const trans = translator?.load('jupyterlab-md-reader')
  const t = (en: string) => (trans ? trans.__(en) : en)
  const { commands, shell } = app

  commands.addCommand(CommandIds.open, {
    label: t('Open with Markdown Reader'),
    caption: t('Open the selected file in the Markdown Reader'),
    icon: mdReaderIcon,
    isEnabled: () => true,
    execute: async (args): Promise<void> => {
      let path = (args?.path as string | undefined) ?? undefined
      if (!path) {
        path = getSelectedFileBrowserPath() ?? undefined
      }
      if (!path) {
        // Last-resort: surface a helpful no-op rather than failing silently.
        if (DEBUG) console.warn('[md-reader] no file selected; aborting open')
        return
      }
      // Use JL's built-in docmanager command — keeps us free of the
      // @jupyterlab/docmanager package dep while still routing through
      // openOrReveal semantics (single instance per path).
      await commands.execute('docmanager:open', {
        path,
        factory: FACTORY_NAME,
      })
    },
  })

  commands.addCommand(CommandIds.toggleCompanion, {
    label: t('Toggle Markdown Reader Companion'),
    caption: t('Show or hide the Markdown Reader companion panel'),
    icon: mdReaderIcon,
    execute: (): void => {
      if (!companion.isAttached) {
        shell.add(companion, 'right', { rank: 1000 })
        shell.activateById(companion.id)
        return
      }
      if (companion.isVisible) {
        // No public `collapseRight` on IShell — toggle visibility by
        // sending a no-op activation to the main area instead.
        const labShell = shell as unknown as {
          collapseRight?: () => void
        }
        if (typeof labShell.collapseRight === 'function') {
          labShell.collapseRight()
        } else {
          companion.hide()
        }
      } else {
        shell.activateById(companion.id)
      }
    },
  })

  commands.addCommand(CommandIds.openSettings, {
    label: t('Markdown Reader Settings…'),
    caption: t('Open the Markdown Reader settings'),
    icon: mdReaderIcon,
    execute: (): Promise<void> => {
      return commands.execute('settingeditor:open', {
        query: 'Markdown Reader',
      }) as Promise<void>
    },
  })
}
