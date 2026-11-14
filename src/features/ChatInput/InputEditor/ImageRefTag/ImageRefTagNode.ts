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

import { ImageRefLabel } from './ImageRefLabel';

export type SerializedImageRefTagNode = Spread<
  { number: number; src: string },
  SerializedLexicalNode
>;

/** Text the model receives for an inline image reference, e.g. `[Image #2]`. */
export const formatImageRef = (number: number) => `[Image #${number}]`;

/**
 * An inline reference to one of the draft's image uploads, rendered as a small
 * "thumbnail + Image N" chip.
 *
 * `src` is the upload's local preview URL, which identifies the upload for its whole
 * lifetime. `number` is the image's position among the draft's images; it is kept in sync
 * with the attachment list, so the chip, the thumbnail badge and the `[Image #N]` text the
 * model receives always agree.
 */
export class ImageRefTagNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __src: string;
  __number: number;

  static getType(): string {
    return 'image-ref-tag';
  }

  static clone(node: ImageRefTagNode): ImageRefTagNode {
    return new ImageRefTagNode(node.__src, node.__number, node.__key);
  }

  static importJSON(serializedNode: SerializedImageRefTagNode): ImageRefTagNode {
    return $createImageRefTagNode(serializedNode.src, serializedNode.number).updateFromJSON(
      serializedNode,
    );
  }

  static importDOM(): null {
    return null;
  }

  constructor(src: string, number: number, key?: string) {
    super(key);
    this.__src = src;
    this.__number = number;
  }

  get src(): string {
    return this.__src;
  }

  get number(): number {
    return this.__number;
  }

  setNumber(number: number): this {
    const writable = this.getWritable();
    writable.__number = number;
    return writable;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.textContent = this.getTextContent();
    return { element };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.imageRefTag);
    return element;
  }

  getTextContent(): string {
    return formatImageRef(this.__number);
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(ImageRefTagNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  /** Rendering inside a sent message, where the local preview URL no longer exists. */
  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(ImageRefLabel, { key, number: this.__number });
  }

  exportJSON(): SerializedImageRefTagNode {
    return {
      ...super.exportJSON(),
      number: this.__number,
      src: this.__src,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedImageRefTagNode>): this {
    return super.updateFromJSON(serializedNode);
  }
}

export function $createImageRefTagNode(src: string, number: number): ImageRefTagNode {
  return $applyNodeReplacement(new ImageRefTagNode(src, number));
}

export function $isImageRefTagNode(node: LexicalNode | null | undefined): node is ImageRefTagNode {
  return node instanceof ImageRefTagNode;
}
