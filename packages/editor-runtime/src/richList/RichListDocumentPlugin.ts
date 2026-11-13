import { ListItemNode } from '@lexical/list';
import type { LexicalEditor } from 'lexical';

import { listHeadingState } from './headingState';
import { listNumberState, registerListNumberOverrides } from './listNumbering';
import { registerRichListMarkdown, type RichListMarkdownService } from './markdown';

// @lobehub/editor's IMarkdownShortCutService. Kernels look services up by this
// name; the constant itself lives in the package's main entry, which pulls in
// React and so cannot be imported by modules the server loads.
const MARKDOWN_SERVICE_ID = { __serviceId: 'MarkdownShortCutService' };

interface ServiceKernel {
  requireService: (serviceId: { __serviceId: string }) => unknown;
}

interface RegisteredNodeInternals {
  sharedNodeState?: { sharedConfigMap?: Map<string, unknown> };
}

/**
 * Lexical only treats a node state as its own once the editor has used its
 * config on a node; until then it is an opaque key. `@lexical/yjs` leaves
 * opaque keys out when it first writes a node to a room, so an editor that
 * seeds a room from stored JSON without ever touching these states would drop
 * them.
 *
 * Lexical has no public way to declare a state on a node class it does not
 * own. Using the configs on a throwaway node would do it, but that is an
 * update at start-up and takes a node key in editors that load pages with
 * their stored keys. So this registers the configs where Lexical itself
 * records them on first use.
 */
const knowListItemStates = (editor: LexicalEditor) => {
  const registered = (editor as unknown as { _nodes: Map<string, RegisteredNodeInternals> })._nodes;
  const configs = registered?.get(ListItemNode.getType())?.sharedNodeState?.sharedConfigMap;
  if (!configs) return;

  for (const config of [listHeadingState, listNumberState]) {
    if (!configs.has(config.key)) configs.set(config.key, config);
  }
};

/**
 * What a document with rich lists needs wherever it is loaded, with or without
 * a DOM: heading list items in Markdown (`- ### Title`), per-item numbering
 * restarts, and both list item states surviving a collaboration room.
 */
export const registerRichListDocument = (
  editor: LexicalEditor,
  markdownService: RichListMarkdownService | null,
) => {
  knowListItemStates(editor);

  const unregisterMarkdown = markdownService ? registerRichListMarkdown(markdownService) : () => {};
  const unregisterNumbering = registerListNumberOverrides(editor);

  return () => {
    unregisterMarkdown();
    unregisterNumbering();
  };
};

/**
 * Kernel plugin for editors without the page editor's UI, such as the server's
 * headless document editor. Register it after ListPlugin and MarkdownPlugin.
 */
export class RichListDocumentPlugin {
  static pluginName = 'LobeRichListDocumentPlugin';

  private cleanup?: () => void;
  private kernel: ServiceKernel;

  constructor(kernel: ServiceKernel) {
    this.kernel = kernel;
  }

  onInit(editor: LexicalEditor): void {
    const service = this.kernel.requireService(
      MARKDOWN_SERVICE_ID,
    ) as RichListMarkdownService | null;
    this.cleanup = registerRichListDocument(editor, service);
  }

  destroy(): void {
    this.cleanup?.();
  }
}
