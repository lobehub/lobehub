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

import { ReferTopicView } from './ReferTopicView';

export type SerializedReferTopicNode = Spread<
  {
    topicId: string;
    topicTitle: string;
  },
  SerializedLexicalNode
>;

export class ReferTopicNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __topicId: string;
  __topicTitle: string;

  static getType(): string {
    return 'refer-topic';
  }

  static clone(node: ReferTopicNode): ReferTopicNode {
    return new ReferTopicNode(node.__topicId, node.__topicTitle, node.__key);
  }

  static importJSON(serializedNode: SerializedReferTopicNode): ReferTopicNode {
    return $createReferTopicNode(serializedNode.topicId, serializedNode.topicTitle).updateFromJSON(
      serializedNode,
    );
  }

  static importDOM(): null {
    return null;
  }

  constructor(topicId: string, topicTitle: string, key?: string) {
    super(key);
    this.__topicId = topicId;
    this.__topicTitle = topicTitle;
  }

  get topicId(): string {
    return this.__topicId;
  }

  get topicTitle(): string {
    return this.__topicTitle;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('span') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.referTopic);
    return element;
  }

  getTextContent(): string {
    return this.__topicTitle;
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedReferTopicNode {
    return {
      ...super.exportJSON(),
      topicId: this.__topicId,
      topicTitle: this.__topicTitle,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedReferTopicNode>): this {
    return super.updateFromJSON(serializedNode);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(ReferTopicNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(ReferTopicView, {
      fallbackTitle: this.__topicTitle,
      key,
      topicId: this.__topicId,
    });
  }
}

export function $createReferTopicNode(topicId: string, topicTitle: string): ReferTopicNode {
  return $applyNodeReplacement(new ReferTopicNode(topicId, topicTitle));
}

export function $isReferTopicNode(node: LexicalNode): node is ReferTopicNode {
  return node.getType() === ReferTopicNode.getType();
}
