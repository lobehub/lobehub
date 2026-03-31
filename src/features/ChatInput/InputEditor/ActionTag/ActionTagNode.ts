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

import { ActionTagView } from './ActionTagView';
import type { ActionTagCategory, ActionTagType } from './types';

export type SerializedActionTagNode = Spread<
  {
    actionCategory: ActionTagCategory;
    actionLabel: string;
    actionType: ActionTagType;
  },
  SerializedLexicalNode
>;

export class ActionTagNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __actionType: ActionTagType;
  __actionCategory: ActionTagCategory;
  __actionLabel: string;

  static getType(): string {
    return 'action-tag';
  }

  static clone(node: ActionTagNode): ActionTagNode {
    return new ActionTagNode(
      node.__actionType,
      node.__actionCategory,
      node.__actionLabel,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedActionTagNode): ActionTagNode {
    return $createActionTagNode(
      serializedNode.actionType,
      serializedNode.actionCategory,
      serializedNode.actionLabel,
    ).updateFromJSON(serializedNode);
  }

  static importDOM(): null {
    return null;
  }

  constructor(
    actionType: ActionTagType,
    actionCategory: ActionTagCategory,
    actionLabel: string,
    key?: string,
  ) {
    super(key);
    this.__actionType = actionType;
    this.__actionCategory = actionCategory;
    this.__actionLabel = actionLabel;
  }

  get actionType(): ActionTagType {
    return this.__actionType;
  }

  get actionCategory(): ActionTagCategory {
    return this.__actionCategory;
  }

  get actionLabel(): string {
    return this.__actionLabel;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('span') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.actionTag);
    return element;
  }

  getTextContent(): string {
    return this.__actionLabel;
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedActionTagNode {
    return {
      ...super.exportJSON(),
      actionCategory: this.__actionCategory,
      actionLabel: this.__actionLabel,
      actionType: this.__actionType,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedActionTagNode>): this {
    return super.updateFromJSON(serializedNode);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(ActionTagNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(ActionTagView, {
      category: this.__actionCategory as ActionTagCategory,
      key,
      label: this.__actionLabel,
    });
  }
}

export function $createActionTagNode(
  actionType: ActionTagType,
  actionCategory: ActionTagCategory,
  actionLabel: string,
): ActionTagNode {
  return $applyNodeReplacement(new ActionTagNode(actionType, actionCategory, actionLabel));
}

export function $isActionTagNode(node: LexicalNode): node is ActionTagNode {
  return node.getType() === ActionTagNode.getType();
}
