import { $isListItemNode, $isListNode, INSERT_ORDERED_LIST_COMMAND } from '@lexical/list';
import type { IEditor } from '@lobehub/editor';
import { $getSelection, $isRangeSelection, type LexicalNode } from 'lexical';

type Listener = (itemKey: string) => void;

const listeners = new WeakMap<IEditor, Set<Listener>>();

/** Subscribes the number menu of `editor` to requests to open it on an item. */
export const onListNumberMenuRequest = (editor: IEditor, listener: Listener) => {
  const set = listeners.get(editor) ?? new Set();
  listeners.set(editor, set);
  set.add(listener);

  return () => {
    set.delete(listener);
  };
};

/** The numbered list item the caret is in; an item holding only a nested list has no number. */
const $numberedItemAtCaret = () => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  let node: LexicalNode | null = selection.anchor.getNode();
  while (node && !$isListItemNode(node)) node = node.getParent();
  if (!node || $isListNode(node.getFirstChild())) return;

  const list = node.getParent();
  return $isListNode(list) && list.getListType() === 'number' ? node : undefined;
};

/**
 * Opens the number menu on the item the caret is in, without the pointer. A
 * block that is not a numbered item becomes one first, so the entry always
 * leads to the menu.
 */
export const requestListNumberMenu = (editor: IEditor) => {
  const lexical = editor.getLexicalEditor();
  if (!lexical) return;

  lexical.update(
    () => {
      if (!$numberedItemAtCaret()) lexical.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    },
    {
      // The menu anchors to the item's element, which exists once this commits.
      onUpdate: () => {
        const key = lexical.getEditorState().read(() => $numberedItemAtCaret()?.getKey());
        if (!key) return;
        for (const listener of listeners.get(editor) ?? []) listener(key);
      },
    },
  );
};
