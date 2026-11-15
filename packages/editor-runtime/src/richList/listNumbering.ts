import { $isListItemNode, $isListNode, type ListItemNode, ListNode } from '@lexical/list';
import {
  $getNodeByKey,
  $getState,
  $setState,
  createState,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

import { $getListItemHeading } from './headingState';

/**
 * A number a list item restarts its list's numbering at.
 *
 * Lexical merges adjacent lists of the same type, so a list cannot be split to
 * renumber from an item in its middle. The item carries the number instead and
 * the transform below applies it.
 */
export const listNumberState = createState('listNumber', {
  parse: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined,
});

// An item that only holds a nested list has no number of its own.
const isWrapperItem = (node: LexicalNode): boolean =>
  $isListItemNode(node) && $isListNode(node.getFirstChild());

const numberedItems = (list: ListNode): ListItemNode[] =>
  list
    .getChildren()
    .filter((child): child is ListItemNode => $isListItemNode(child) && !isWrapperItem(child));

const $isFirstNumberedItem = (item: ListItemNode) =>
  item
    .getPreviousSiblings()
    .every((sibling) => !$isListItemNode(sibling) || isWrapperItem(sibling));

/**
 * Renumbers ordered lists honouring per-item restarts. Runs after Lexical's own
 * list transform, which numbers items from the list start alone.
 */
export const registerListNumberOverrides = (editor: LexicalEditor) =>
  editor.registerNodeTransform(ListNode, (list) => {
    if (list.getListType() !== 'number') return;

    // The state before this update: a node missing from it was made just now.
    const before = editor.getEditorState();
    const existed = (node: LexicalNode) => before.read(() => $getNodeByKey(node.getKey()) !== null);

    let value = list.getStart();
    let previous: ListItemNode | undefined;

    for (const child of list.getChildren()) {
      if (!$isListItemNode(child)) continue;
      if (isWrapperItem(child)) {
        if (child.getValue() !== value) child.setValue(value);
        continue;
      }

      let override = $getState(child, listNumberState);
      // Enter copies an item together with its state; the copy continues the
      // numbering instead of restarting it a second time. Only a new item
      // right after an older one with the same restart is such a copy: two
      // older items were each restarted on purpose, and two new ones arrived
      // together (a paste, a loaded document) already holding what they mean.
      if (
        override !== undefined &&
        previous &&
        override === $getState(previous, listNumberState) &&
        !existed(child) &&
        existed(previous)
      ) {
        $setState(child, listNumberState, undefined);
        override = undefined;
      }
      if (override !== undefined) value = override;
      if (child.getValue() !== value) child.setValue(value);

      previous = child;
      value += 1;
    }
  });

/**
 * The last number an earlier ordered list gave an item of the same kind: a
 * heading item continues earlier heading items of its level, a plain item
 * earlier plain items.
 */
const $findPreviousNumber = (item: ListItemNode): number | undefined => {
  const list = item.getParent();
  if (!$isListNode(list)) return;
  const heading = $getListItemHeading(item);

  for (const sibling of list.getPreviousSiblings().reverse()) {
    if (!$isListNode(sibling) || sibling.getListType() !== 'number') continue;
    const match = numberedItems(sibling).findLast(
      (candidate) => $getListItemHeading(candidate) === heading,
    );
    if (match) return match.getValue();
  }
};

export interface ListNumbering {
  /** Whether "continue numbering" changes anything. */
  canContinue: boolean;
  isHeading: boolean;
  value: number;
}

export const $getListNumbering = (item: ListItemNode): ListNumbering => ({
  canContinue: $isFirstNumberedItem(item)
    ? $findPreviousNumber(item) !== undefined
    : $getState(item, listNumberState) !== undefined,
  isHeading: $getListItemHeading(item) !== undefined,
  value: item.getValue(),
});

/** Number the item (and the items after it) from `value`. */
export const $setListItemNumber = (item: ListItemNode, value: number) => {
  const list = item.getParent();
  if (!$isListNode(list)) return;

  if ($isFirstNumberedItem(item)) {
    $setState(item, listNumberState, undefined);
    list.setStart(value);
  } else {
    $setState(item, listNumberState, value);
  }
  // Renumber even when only the item's state changed.
  list.getWritable();
};

/**
 * The first item continues the numbering of an earlier list; any other item
 * drops its restart and continues the item above it.
 */
export const $continueListNumbering = (item: ListItemNode) => {
  if (!$isFirstNumberedItem(item)) {
    $setState(item, listNumberState, undefined);
    item.getParent()?.getWritable();
    return;
  }

  const previous = $findPreviousNumber(item);
  if (previous !== undefined) $setListItemNumber(item, previous + 1);
};
