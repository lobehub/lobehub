import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';

import { $createActionTagNode, $isActionTagNode } from './ActionTagNode';
import { GOAL_COMMAND_TYPE } from './types';

/**
 * The goal marker is stored as a real node in the editor document — not as a
 * composer-level boolean rewritten into the text at send time — so it survives
 * drafts, lands in the persisted `editorData`, and renders as a chip in the sent
 * bubble instead of disappearing into a raw `/goal` prefix nobody can see.
 */
const $hasGoalTag = (): boolean => {
  const stack: LexicalNode[] = $getRoot().getChildren();

  while (stack.length > 0) {
    const node = stack.pop()!;
    if ($isActionTagNode(node) && node.actionType === GOAL_COMMAND_TYPE) return true;
    if ($isElementNode(node)) stack.push(...node.getChildren());
  }

  return false;
};

/**
 * True when `block` holds inline children, so the inline chip can be prepended
 * straight into it.
 *
 * `$isElementNode` alone is not that test: a list, table, or quote-of-blocks is an
 * ElementNode too, and its children are rows / items, not inline content.
 * Prepending the chip there would break that container's child contract, and the
 * chip could end up serialized somewhere other than the head of the message —
 * which is the one place `isGoalPrompt` accepts it.
 */
const $acceptsInlineChildren = (block: ElementNode): boolean => {
  const first = block.getFirstChild();
  // An empty block offers nothing to infer from; only a paragraph is certain.
  if (!first) return $isParagraphNode(block);
  if ($isTextNode(first) || $isLineBreakNode(first)) return true;

  return ($isElementNode(first) || $isDecoratorNode(first)) && first.isInline();
};

/**
 * True when the caret would sit in front of the chip — including the case where
 * there is no usable selection at all, which is what an empty composer leaves
 * behind after the slash plugin removes the `/goal` query text.
 */
const $caretIsInFrontOf = (tag: LexicalNode): boolean => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return true;

  const parent = tag.getParent();
  if (!$isElementNode(parent)) return true;

  // The point immediately behind the chip, to compare the live caret against.
  const boundary = $createRangeSelection();
  boundary.anchor.set(parent.getKey(), tag.getIndexWithinParent() + 1, 'element');

  return selection.anchor.isBefore(boundary.anchor);
};

/**
 * Put the goal chip at the very start of the document, with the caret behind it.
 *
 * Neither half is cosmetic. The markdown writer serializes the chip back to
 * `/goal `, and both the client tool gate and the server system role only accept
 * it as the message's *prefix* (`isGoalPrompt`). Inserting at the caret would
 * bury the chip mid-message — the slash menu can fire from any line start, and
 * the `+` menu can fire after the user has already typed. And leaving the caret
 * where it was is just as damaging on the slash path: an empty composer parks it
 * at the block start, so the goal the user then types lands *in front of* the
 * chip and silently destroys the very prefix the chip stands for.
 *
 * A caret that is already behind the chip is left alone — on the `+` menu path it
 * is wherever the user stopped typing, and yanking it to the head of their own
 * sentence would be its own annoyance.
 */
export const insertGoalTag = (editor: IEditor | undefined, label: string) => {
  const lexicalEditor = editor?.getLexicalEditor();
  if (!editor || !lexicalEditor) return;

  lexicalEditor.update(() => {
    // One goal per message — a second chip would serialize a second `/goal `.
    if ($hasGoalTag()) return;

    const tag = $createActionTagNode(GOAL_COMMAND_TYPE, 'command', label);
    const root = $getRoot();
    const firstBlock = root.getFirstChild();

    // The chip is inline, so it only goes inside a block that actually takes
    // inline children; a list, table, or code block gets a paragraph in front of
    // it instead, which still leaves the chip leading the message.
    if ($isElementNode(firstBlock) && $acceptsInlineChildren(firstBlock)) {
      const firstInline = firstBlock.getFirstChild();
      if (firstInline) firstInline.insertBefore(tag);
      else firstBlock.append(tag);
    } else {
      const paragraph = $createParagraphNode();
      paragraph.append(tag);
      if (firstBlock) firstBlock.insertBefore(paragraph);
      else root.append(paragraph);
    }

    if ($caretIsInFrontOf(tag)) tag.selectNext(0, 0);
  });

  editor.focus();
};
