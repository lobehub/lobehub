import { addClassNamesToElement } from '@lexical/utils';
import { getKernelFromEditor } from '@lobehub/editor';
import type { HeadlessRenderableNode, HeadlessRenderContext } from '@lobehub/editor/renderer';
import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { createElement } from 'react';

import { ReferDocumentView } from './ReferDocumentView';

export type SerializedReferDocumentNode = Spread<
  {
    documentId: string;
    title: string;
  },
  SerializedLexicalNode
>;

export class ReferDocumentNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __documentId: string;
  __title: string;

  static getType(): string {
    return 'refer-document';
  }

  static clone(node: ReferDocumentNode): ReferDocumentNode {
    return new ReferDocumentNode(node.__documentId, node.__title, node.__key);
  }

  static importJSON(serializedNode: SerializedReferDocumentNode): ReferDocumentNode {
    return $createReferDocumentNode(serializedNode.documentId, serializedNode.title).updateFromJSON(
      serializedNode,
    );
  }

  static importDOM(): null {
    return null;
  }

  constructor(documentId: string, title: string, key?: string) {
    super(key);
    this.__documentId = documentId;
    this.__title = title;
  }

  get documentId(): string {
    return this.__documentId;
  }

  get title(): string {
    return this.__title;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('span') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.referDocument);
    return element;
  }

  getTextContent(): string {
    return this.__title;
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedReferDocumentNode {
    return {
      ...super.exportJSON(),
      documentId: this.__documentId,
      title: this.__title,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedReferDocumentNode>): this {
    return super.updateFromJSON(serializedNode);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(ReferDocumentNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(ReferDocumentView, { key, title: this.__title });
  }
}

export function $createReferDocumentNode(documentId: string, title: string): ReferDocumentNode {
  return $applyNodeReplacement(new ReferDocumentNode(documentId, title));
}

export function $isReferDocumentNode(node: LexicalNode): node is ReferDocumentNode {
  return node.getType() === ReferDocumentNode.getType();
}
