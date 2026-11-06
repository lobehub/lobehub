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

import { ReferArtboardView } from './ReferArtboardView';
import type { ArtboardReference } from './serialize';

export type SerializedReferArtboardNode = Spread<ArtboardReference, SerializedLexicalNode>;

export class ReferArtboardNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __reference: ArtboardReference;

  static getType(): string {
    return 'refer-artboard';
  }

  static clone(node: ReferArtboardNode): ReferArtboardNode {
    return new ReferArtboardNode(node.__reference, node.__key);
  }

  static importJSON(serialized: SerializedReferArtboardNode): ReferArtboardNode {
    const { artboardId, itemId, itemKind, itemTitle, kind, text } = serialized;
    return $createReferArtboardNode({
      artboardId,
      itemId,
      itemKind,
      itemTitle,
      kind,
      text,
    }).updateFromJSON(serialized);
  }

  static importDOM(): null {
    return null;
  }

  constructor(reference: ArtboardReference, key?: string) {
    super(key);
    this.__reference = reference;
  }

  get reference(): ArtboardReference {
    return this.__reference;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('span') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.referArtboard);
    return element;
  }

  getTextContent(): string {
    return this.__reference.text;
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedReferArtboardNode {
    return { ...super.exportJSON(), ...this.__reference };
  }

  updateFromJSON(serialized: LexicalUpdateJSON<SerializedReferArtboardNode>): this {
    return super.updateFromJSON(serialized);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(ReferArtboardNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return { queryDOM: decorator.queryDOM, render: decorator.render(this, editor) };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(ReferArtboardView, { key, reference: this.__reference });
  }
}

export function $createReferArtboardNode(reference: ArtboardReference): ReferArtboardNode {
  return $applyNodeReplacement(new ReferArtboardNode(reference));
}

export function $isReferArtboardNode(
  node: LexicalNode | null | undefined,
): node is ReferArtboardNode {
  return node?.getType() === ReferArtboardNode.getType();
}
