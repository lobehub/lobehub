import { LITEXML_APPLY_COMMAND, LITEXML_MODIFY_COMMAND } from '@lobehub/editor';

import { EditorRuntime as BaseEditorRuntime, type LiteXMLAdapter } from './EditorRuntime';

const rendererLiteXMLAdapter: LiteXMLAdapter = {
  applyBatch: (editor, operations) => {
    editor.dispatchCommand(LITEXML_MODIFY_COMMAND, operations);
  },
  applyReplace: (editor, litexml) => {
    editor.dispatchCommand(LITEXML_APPLY_COMMAND, { litexml });
  },
};

/**
 * Renderer-bound EditorRuntime. Constructor pre-wires the LiteXML adapter
 * against `@lobehub/editor`'s `LITEXML_*_COMMAND` symbols so renderer call
 * sites don't have to opt in. Server code must import from
 * `@lobechat/editor-runtime/server` — pulling this entry into Node crashes
 * (ReactSlashPlugin evaluates `document.createElement` at module top level).
 */
export class EditorRuntime extends BaseEditorRuntime {
  constructor() {
    super();
    this.setLiteXMLAdapter(rendererLiteXMLAdapter);
  }
}

export type { LiteXMLAdapter, LiteXMLBatchOperation } from './EditorRuntime';
export * from './types';
