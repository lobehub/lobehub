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

import { LocalFile } from '@/features/LocalFile';

export type SerializedLocalFileTagNode = Spread<
  {
    isDirectory: boolean;
    name: string;
    path: string;
  },
  SerializedLexicalNode
>;

/**
 * A local-file reference rendered as a compact "icon + name" chip, mirroring the
 * ReferTopic / ActionTag custom-node pattern. Kept separate from the generic
 * `mention` node so it can render a file/folder icon (instead of the hardcoded
 * `@`) and — crucially — own its `<localFile … />` markdown writer via a plugin
 * that is always registered, independent of whether `mentionOption` is enabled.
 */
export class LocalFileTagNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __name: string;
  __path: string;
  __isDirectory: boolean;

  static getType(): string {
    return 'local-file-tag';
  }

  static clone(node: LocalFileTagNode): LocalFileTagNode {
    return new LocalFileTagNode(node.__name, node.__path, node.__isDirectory, node.__key);
  }

  static importJSON(serializedNode: SerializedLocalFileTagNode): LocalFileTagNode {
    return $createLocalFileTagNode(
      serializedNode.name,
      serializedNode.path,
      serializedNode.isDirectory,
    ).updateFromJSON(serializedNode);
  }

  static importDOM(): null {
    return null;
  }

  constructor(name: string, path: string, isDirectory = false, key?: string) {
    super(key);
    this.__name = name;
    this.__path = path;
    this.__isDirectory = isDirectory;
  }

  get name(): string {
    return this.__name;
  }

  get path(): string {
    return this.__path;
  }

  get isDirectory(): boolean {
    return this.__isDirectory;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('span') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.localFileTag);
    return element;
  }

  getTextContent(): string {
    return this.__name;
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedLocalFileTagNode {
    return {
      ...super.exportJSON(),
      isDirectory: this.__isDirectory,
      name: this.__name,
      path: this.__path,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedLocalFileTagNode>): this {
    return super.updateFromJSON(serializedNode);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(LocalFileTagNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(LocalFile, {
      isDirectory: this.__isDirectory,
      key,
      name: this.__name,
      path: this.__path,
    });
  }
}

export function $createLocalFileTagNode(
  name: string,
  path: string,
  isDirectory = false,
): LocalFileTagNode {
  return $applyNodeReplacement(new LocalFileTagNode(name, path, isDirectory));
}

export function $isLocalFileTagNode(
  node: LexicalNode | null | undefined,
): node is LocalFileTagNode {
  return node instanceof LocalFileTagNode;
}
