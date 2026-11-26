import { addClassNamesToElement } from '@lexical/utils';
import { formatImageRef } from '@lobechat/const/imageRef';
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
  { fileId?: string; number: number; src: string },
  SerializedLexicalNode
>;

export { formatImageRef };

/**
 * An inline reference to one of the draft's image uploads, rendered as a small
 * "thumbnail + Image N" chip.
 *
 * `src` is the upload's local preview URL, which identifies the upload for its whole
 * lifetime. `number` is the image's position among the draft's images; it is kept in sync
 * with the attachment list, so the chip and the `[Image #N]` text the model receives always
 * agree. The image cards themselves show no number: a sent message's images are read back
 * without an order, so a number there would promise a position the message cannot keep.
 *
 * `fileId` is the uploaded file's id, recorded once the upload finishes. It survives in the
 * sent message's editor data, so a reference restored into the composer, whose image now has
 * a server URL instead of the old preview URL, can be bound to that image again.
 */
export class ImageRefTagNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __src: string;
  __number: number;
  __fileId?: string;

  static getType(): string {
    return 'image-ref-tag';
  }

  static clone(node: ImageRefTagNode): ImageRefTagNode {
    return new ImageRefTagNode(node.__src, node.__number, node.__key, node.__fileId);
  }

  static importJSON(serializedNode: SerializedImageRefTagNode): ImageRefTagNode {
    return $createImageRefTagNode(
      serializedNode.src,
      serializedNode.number,
      serializedNode.fileId,
    ).updateFromJSON(serializedNode);
  }

  static importDOM(): null {
    return null;
  }

  constructor(src: string, number: number, key?: string, fileId?: string) {
    super(key);
    this.__src = src;
    this.__number = number;
    this.__fileId = fileId;
  }

  get src(): string {
    return this.__src;
  }

  get number(): number {
    return this.__number;
  }

  get fileId(): string | undefined {
    return this.__fileId;
  }

  setNumber(number: number): this {
    const writable = this.getWritable();
    writable.__number = number;
    return writable;
  }

  /** Points the reference at another upload of the same file, e.g. a restored attachment. */
  setUpload(src: string, fileId: string | undefined): this {
    const writable = this.getWritable();
    writable.__src = src;
    writable.__fileId = fileId;
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
      ...(this.__fileId && { fileId: this.__fileId }),
      number: this.__number,
      src: this.__src,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedImageRefTagNode>): this {
    return super.updateFromJSON(serializedNode);
  }
}

export function $createImageRefTagNode(
  src: string,
  number: number,
  fileId?: string,
): ImageRefTagNode {
  return $applyNodeReplacement(new ImageRefTagNode(src, number, undefined, fileId));
}

export function $isImageRefTagNode(node: LexicalNode | null | undefined): node is ImageRefTagNode {
  return node instanceof ImageRefTagNode;
}
