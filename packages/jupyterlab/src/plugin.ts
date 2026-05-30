// JupyterLab plugin entry for @md-reader/jupyterlab.
//
// Responsibilities:
//   - Register an `MdReaderWidgetFactory` against the built-in `markdown`
//     file type. We do NOT set `defaultFor` here — the user opts in via
//     "Open with → Markdown Reader" or via a docmanager settings transform
//     that flips the default viewer once the user enables it in settings.
//   - Maintain a `WidgetTracker<MdReaderDocumentWidget>` (exposed via
//     `IMdReaderTracker`) so layout restore + companion-panel binding work.
//   - Mount the JL-native CompanionPanel in the `'right'` shell area.
//   - Snapshot JL theme vars and forward them to active reader instances on
//     theme change + body class mutation.
//   - Register palette + context-menu entries for `md-reader:open` and
//     `md-reader:toggle-companion`.
//   - Add a settings transform on `@jupyterlab/docmanager-extension:plugin`
//     so markdown files default to "Markdown Reader" when the user enables
//     that in our settings.
//   - Register a status-bar item ("md-reader ready / disabled / error").

import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application'
import { ILayoutRestorer } from '@jupyterlab/application'
import {
  ICommandPalette,
  IThemeManager,
  Notification,
  WidgetTracker,
} from '@jupyterlab/apputils'
import { IStatusBar } from '@jupyterlab/statusbar'
import { ISettingRegistry } from '@jupyterlab/settingregistry'
import { ITranslator, nullTranslator } from '@jupyterlab/translation'
import { MdReaderWidgetFactory } from './factory'
import {
  IMdReaderTracker,
  MdReaderDocumentWidget,
} from './widgets/MdReaderDocumentWidget'
import { MdReaderCompanionPanel } from './widgets/CompanionPanel'
import { MdReaderStatusItem } from './widgets/StatusItem'
import { CommandIds, registerCommands } from './commands'
import { snapshotTheme, detectDarkFromVars } from './bridge/MessageBridge'
import { PACKAGE_VERSION } from './_version'

const PLUGIN_ID = '@md-reader/jupyterlab:plugin'
const FACTORY_NAME = 'md-reader'
const FILE_TYPE = 'markdown'
// Sourced from `package.json` via the generated `_version.ts` (see
// `scripts/sync-version.mjs`). Used as the iframe cache-buster and the
// host-identity string sent to the iframe via HELLO. A single source of
// truth across package.json, plugin.ts, and Python `__init__.py` (which
// reads from importlib.metadata).
const HOST_VERSION = PACKAGE_VERSION

// Set `globalThis.MDR_DEBUG = true` in the browser console to enable verbose
// developer logging. Off by default so the JL console stays clean.
const DEBUG =
  typeof globalThis !== 'undefined' &&
  (globalThis as Record<string, unknown>).MDR_DEBUG === true

/** Forward the snapshotted theme to every reader widget the tracker knows about. */
function broadcastTheme(tracker: WidgetTracker<MdReaderDocumentWidget>): void {
  const vars = snapshotTheme()
  const dark = detectDarkFromVars(vars)
  const fontFamily = vars['--jp-content-font-family'] || ''
  const fontSize = parseFloat(vars['--jp-content-font-size1'] || '14') || 14
  tracker.forEach(w => {
    if (w.isDisposed) return
    w.content.setTheme({
      dark,
      fontFamily,
      fontSize,
      jpVars: vars,
      highContrast: document.body.classList.contains('jp-mod-highContrast'),
    })
  })
}

const plugin: JupyterFrontEndPlugin<WidgetTracker<MdReaderDocumentWidget>> = {
  id: PLUGIN_ID,
  description:
    'AI-grounded markdown reading + kernel-bound reasoning workstation',
  autoStart: true,
  provides: IMdReaderTracker,
  requires: [],
  optional: [
    IThemeManager,
    ILayoutRestorer,
    ICommandPalette,
    IStatusBar,
    ISettingRegistry,
    ITranslator,
  ],
  activate: (
    app: JupyterFrontEnd,
    themeManager: IThemeManager | null,
    restorer: ILayoutRestorer | null,
    palette: ICommandPalette | null,
    statusBar: IStatusBar | null,
    settingRegistry: ISettingRegistry | null,
    translatorOpt: ITranslator | null,
  ): WidgetTracker<MdReaderDocumentWidget> => {
    const translator = translatorOpt ?? nullTranslator
    const trans = translator.load('jupyterlab-md-reader')

    // ── Tracker ──────────────────────────────────────────────────────────
    const tracker = new WidgetTracker<MdReaderDocumentWidget>({
      namespace: 'md-reader',
    })

    // ── Factory ──────────────────────────────────────────────────────────
    const factory = new MdReaderWidgetFactory({
      name: FACTORY_NAME,
      modelName: 'text',
      fileTypes: [FILE_TYPE],
      defaultFor: [],
      readOnly: false,
      hostVersion: HOST_VERSION,
      translator,
    })

    factory.widgetCreated.connect((_sender, widget) => {
      void tracker.add(widget)
      // Seed the companion panel proactively — the tracker's
      // `currentChanged` signal only fires once focus actually moves to
      // the new widget, which doesn't happen for restorable widgets
      // until the layout restorer hydrates them. Pushing here gets the
      // outline visible right after `docmanager:open`.
      companion.setActiveDoc(widget)
      // Push theme once on creation. DocumentWidget already updates its
      // own title.label / title.caption on path changes via the context
      // signals it subscribes to, so we deliberately don't touch them
      // here — assigning to title.caption ourselves would trigger
      // `_onTitleChanged` → rename loops on every reload.
      broadcastTheme(tracker)
      // Forward the host locale to the new iframe — purely plumbing for
      // v0.2.1, the iframe side just persists it for now.
      try {
        widget.content.setLocale({ languageCode: translator.languageCode })
      } catch {
        // ignore — locale forwarding must never break widget creation.
      }
      // Surface bridge-level protocol failures (version skew, bad handshake,
      // malformed envelope) in the JL status bar + a non-blocking toast so
      // users don't stare at a blank iframe wondering what went wrong.
      try {
        widget.content.onError(err => {
          if (statusItem) {
            statusItem.setStatus({
              status: 'error',
              label: trans.__('md-reader (error)'),
            })
          }
          Notification.emit(
            trans.__('Markdown Reader: %1', err.message),
            'error',
            { autoClose: 6000 },
          )
        })
      } catch {
        // ignore — bridge error wiring is best-effort, never gate widget creation on it
      }
    })

    app.docRegistry.addWidgetFactory(factory)

    // ── Companion panel (right shell area) ───────────────────────────────
    const companion = new MdReaderCompanionPanel(translator)

    if (restorer) {
      void restorer.restore(tracker, {
        command: 'docmanager:open',
        args: w => ({ path: w.context.path, factory: FACTORY_NAME }),
        name: w => w.context.path,
      })
      restorer.add(companion, 'md-reader-companion')
    }

    // ── Active doc → companion sync ──────────────────────────────────────
    const updateCompanion = (): void => {
      const current = tracker.currentWidget
      companion.setActiveDoc(current ?? null)
    }
    tracker.currentChanged.connect(updateCompanion)

    // ── Commands ─────────────────────────────────────────────────────────
    registerCommands({ app, tracker, companion, translator })

    if (palette) {
      const category = trans.__('Markdown Reader')
      palette.addItem({ command: CommandIds.open, category })
      palette.addItem({ command: CommandIds.toggleCompanion, category })
      palette.addItem({ command: CommandIds.openSettings, category })
    }

    // Context menu on file browser items for markdown files.
    app.contextMenu.addItem({
      command: CommandIds.open,
      selector: '.jp-DirListing-item[data-file-type="markdown"]',
      rank: 0,
    })

    // ── Theme observers ──────────────────────────────────────────────────
    const themeSlot = (): void => broadcastTheme(tracker)
    if (themeManager) {
      themeManager.themeChanged.connect(themeSlot)
    }
    // Watch <body> class for jp-mod-dark / jp-mod-highContrast toggles.
    const bodyObserver = new MutationObserver(themeSlot)
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    })

    // ── Settings ─────────────────────────────────────────────────────────
    // Forward-declare so broadcastSettings (defined next) can reach the
    // status item without depending on declaration order with the
    // `if (statusBar)` block further down.
    let statusItem: MdReaderStatusItem | null = null
    let lastSettings: {
      aiBackend: 'ollama' | 'openrouter' | 'webllm' | 'disabled'
      ollamaUrl?: string
      enabledFeatures: string[]
      telemetry: boolean
      kernelBridge: boolean
      companionPanel: boolean
    } = {
      aiBackend: 'disabled',
      ollamaUrl: 'http://localhost:11434',
      enabledFeatures: ['toc', 'highlights', 'comments', 'mindmap'],
      telemetry: false,
      kernelBridge: true,
      companionPanel: true,
    }
    const broadcastSettings = (): void => {
      tracker.forEach(w => w.content.setSettings(lastSettings))
      // Reflect AI-backend state in the status bar so users can see at a
      // glance whether md-reader will respond to AI commands.
      if (statusItem) {
        const disabled = lastSettings.aiBackend === 'disabled'
        statusItem.setStatus({
          status: disabled ? 'disabled' : 'ok',
          label: disabled
            ? trans.__('md-reader (AI off)')
            : trans.__('md-reader'),
        })
      }
    }

    if (settingRegistry) {
      void settingRegistry
        .load(PLUGIN_ID)
        .then(settings => {
          const apply = (): void => {
            const ai = (settings.get('ai').composite as
              | { provider?: string; ollamaUrl?: string }
              | undefined) ?? {}
            const provider = (ai.provider as
              | 'ollama'
              | 'openrouter'
              | 'webllm'
              | 'disabled'
              | undefined) ?? 'disabled'
            lastSettings = {
              aiBackend: provider,
              ollamaUrl: ai.ollamaUrl,
              enabledFeatures:
                (settings.get('enabledFeatures').composite as string[]) ?? [],
              telemetry:
                (settings.get('telemetry').composite as boolean) ?? false,
              kernelBridge:
                (settings.get('kernelBridge').composite as boolean) ?? true,
              companionPanel:
                (settings.get('companionPanel').composite as boolean) ?? true,
            }
            broadcastSettings()
            if (lastSettings.companionPanel && !companion.isAttached) {
              app.shell.add(companion, 'right', { rank: 1000 })
            }
          }
          apply()
          settings.changed.connect(apply)
        })
        .catch(err => {
          if (DEBUG) console.warn('[md-reader/jupyterlab] settings load failed', err)
          // User-relevant failure — surface via JL's notification system so
          // the user knows their settings won't apply this session.
          Notification.emit(
            trans.__('Markdown Reader: failed to load settings'),
            'warning',
            { autoClose: 4000 },
          )
        })

      // NOTE(v0.2): We intentionally do not register a transform on
      // `@jupyterlab/docmanager-extension:plugin` to add `markdown →
      // "Markdown Reader"` to `defaultViewers`. The settingRegistry only
      // permits a single transformer per plugin, and on a fresh JL install
      // docmanager-extension already has one registered (its own). Calling
      // `settingRegistry.transform(...)` here throws TransformError and
      // crashes the activation of the docmanager. Users opt in per-file
      // via "Open with → Markdown Reader" or the context menu. A future
      // PR can land a coordinated transformer once we own the integration
      // with @jupyterlab/docmanager-extension.
    }

    // ── Status-bar item ──────────────────────────────────────────────────
    // ReactWidget-based; reacts to setting changes via setStatus().
    if (statusBar) {
      statusItem = new MdReaderStatusItem({
        status: 'ok',
        label: trans.__('md-reader'),
      })
      statusItem.id = 'md-reader-status'
      statusBar.registerStatusItem('@md-reader/jupyterlab:status', {
        item: statusItem,
        align: 'right',
        rank: 200,
        isActive: () => true,
      })
    }

    // ── Ready toast (once, on first activation) ──────────────────────────
    Notification.emit(
      trans.__('Markdown Reader extension ready'),
      'success',
      { autoClose: 2500 },
    )

    // Push initial theme + settings broadcast (best-effort; tracker is
    // likely empty on activate, but doesn't hurt).
    broadcastTheme(tracker)
    broadcastSettings()

    return tracker
  },
}

export default plugin
