import { getRegisteredNode, type LexicalEditor } from 'lexical';

import { MARKDOWN_SERVICE_ID, type ServiceKernel } from '../markdownService';

interface ReadNode {
  [key: string]: unknown;
  type: string;
}

interface MarkdownRootService {
  registerMarkdownReader: (type: string, reader: never, level?: number) => void;
}

// @lobehub/editor's INodeHelper base fields. The helper lives behind the
// package's main entry, which the server cannot load.
const BASE_CONTENT = { direction: 'ltr', format: '', indent: 0, version: 1 } as const;

/**
 * Lexical's root holds element and decorator nodes only (`RootNode.splice`).
 *
 * Decided by what the node class can do, not by `instanceof`: the server bundle
 * loads its own copy of `lexical` for this package, so the editor's node classes
 * do not extend the `ElementNode` imported here, and every block would look
 * like text and be wrapped.
 */
const canSitAtRoot = (editor: LexicalEditor, node: ReadNode) => {
  const prototype = getRegisteredNode(editor, node.type)?.klass.prototype;
  // An unregistered type is a different failure, and Lexical names it itself.
  if (!prototype) return true;

  const hasMethod = (name: string) => typeof Reflect.get(prototype, name) === 'function';
  return hasMethod('getChildren') || hasMethod('decorate');
};

/**
 * Wraps each run of root children that Lexical would refuse in a paragraph.
 *
 * @lobehub/editor's Markdown reader keeps an HTML block it has no reader for
 * (`<alert type="…">…</alert>`, `<div>`, an unclosed or stray tag) as a plain
 * text node, which is fine inside a paragraph or list item but not at the root.
 * There Lexical's `parseEditorState` throws, reports the error to the editor and
 * keeps the state built so far, so every block after the HTML vanished from the
 * document without any error reaching the writer.
 */
export const wrapInlineRootChildren = (editor: LexicalEditor, children: ReadNode[]): ReadNode[] => {
  const blocks: ReadNode[] = [];
  let paragraph: ReadNode[] | undefined;

  for (const child of children) {
    if (canSitAtRoot(editor, child)) {
      paragraph = undefined;
      blocks.push(child);
      continue;
    }

    if (!paragraph) {
      paragraph = [];
      blocks.push({
        ...BASE_CONTENT,
        children: paragraph,
        textFormat: 0,
        textStyle: '',
        type: 'paragraph',
      });
    }
    paragraph.push(child);
  }

  return blocks;
};

/**
 * Kernel plugin that keeps Markdown with raw HTML blocks whole when it is
 * parsed into a document. Register it after MarkdownPlugin.
 */
export class MarkdownRootDocumentPlugin {
  static pluginName = 'LobeMarkdownRootDocumentPlugin';

  private kernel: ServiceKernel;

  constructor(kernel: ServiceKernel) {
    this.kernel = kernel;
  }

  onInit(editor: LexicalEditor): void {
    const service = this.kernel.requireService(MARKDOWN_SERVICE_ID) as MarkdownRootService | null;
    // The root reader replaces the editor's default one, which only builds this node.
    service?.registerMarkdownReader('root', ((_node: unknown, children: ReadNode[]) => ({
      ...BASE_CONTENT,
      children: wrapInlineRootChildren(editor, children),
      type: 'root',
    })) as never);
  }
}
