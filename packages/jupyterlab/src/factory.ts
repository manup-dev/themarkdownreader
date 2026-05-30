// DocumentWidgetFactory for md-reader. Returns an `MdReaderDocumentWidget`
// wrapping an `MdReaderPanel`. Toolbar buttons (save/etc.) come from JL's
// standard `toolbar` mechanism in the plugin via factory.registerWidgetExt
// / DocumentWidget defaults — we lean on the inherited DocumentWidget
// toolbar (save, etc.) rather than crafting our own.

import { ABCWidgetFactory } from '@jupyterlab/docregistry'
import type { DocumentRegistry } from '@jupyterlab/docregistry'
import type { ITranslator } from '@jupyterlab/translation'
import { UUID } from '@lumino/coreutils'
import { MdReaderPanel } from './widgets/MdReaderPanel'
import { MdReaderDocumentWidget } from './widgets/MdReaderDocumentWidget'

export interface MdReaderFactoryOptions
  extends DocumentRegistry.IWidgetFactoryOptions {
  hostVersion: string
  translator?: ITranslator
}

export class MdReaderWidgetFactory extends ABCWidgetFactory<
  MdReaderDocumentWidget,
  DocumentRegistry.IModel
> {
  private hostVersion: string
  // Stored under a private name to avoid clashing with the base class'
  // (typed) `translator: ITranslator` field.
  private _mdrTranslator?: ITranslator

  constructor(options: MdReaderFactoryOptions) {
    const { hostVersion, translator, ...rest } = options
    super(rest)
    this.hostVersion = hostVersion
    this._mdrTranslator = translator
  }

  protected createNewWidget(
    context: DocumentRegistry.IContext<DocumentRegistry.IModel>,
  ): MdReaderDocumentWidget {
    const content = new MdReaderPanel({
      hostVersion: this.hostVersion,
      // v0.2: no real user identity. Stub with a per-session UUID so the
      // iframe can scope its IndexedDB without leaking across browsers.
      sessionId: UUID.uuid4(),
      userId: 'local',
    })
    return new MdReaderDocumentWidget({
      content,
      context,
      translator: this._mdrTranslator,
    })
  }
}
