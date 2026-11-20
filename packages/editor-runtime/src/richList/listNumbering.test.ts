import { $isListItemNode, $isListNode, type ListItemNode } from '@lexical/list';
import { CommonPlugin, Kernel, ListPlugin, MarkdownPlugin } from '@lobehub/editor';
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import { $continueListNumbering, $getListNumbering, $setListItemNumber } from './listNumbering';
import { RichListDocumentPlugin } from './RichListDocumentPlugin';

const setup = (markdown: string) => {
  const kernel = new Kernel();
  kernel.registerPlugins([
    CommonPlugin,
    MarkdownPlugin,
    ListPlugin,
    RichListDocumentPlugin as never,
  ]);
  const editor = kernel.initNodeEditor()!;
  kernel.setDocument('markdown', markdown);
  return editor;
};

// The numbered items of every top-level list, by text.
const $items = (): Record<string, ListItemNode> =>
  Object.fromEntries(
    $getRoot()
      .getChildren()
      .filter($isListNode)
      .flatMap((list) => list.getChildren().filter($isListItemNode))
      .map((item) => [item.getTextContent(), item]),
  );

const act = (editor: LexicalEditor, fn: (items: Record<string, ListItemNode>) => void) =>
  editor.update(() => fn($items()), { discrete: true });

const numbers = (editor: LexicalEditor) =>
  editor
    .getEditorState()
    .read(() => Object.entries($items()).map(([text, item]) => `${item.getValue()}. ${text}`));

describe('list numbering', () => {
  it('restarts numbering from a middle item and keeps the items after it in step', () => {
    const editor = setup('1. a\n2. b\n3. c\n');

    act(editor, (items) => $setListItemNumber(items.b, 5));

    expect(numbers(editor)).toEqual(['1. a', '5. b', '6. c']);
  });

  it('sets the list start when the first item is renumbered', () => {
    const editor = setup('1. a\n2. b\n');

    act(editor, (items) => $setListItemNumber(items.a, 4));

    expect(numbers(editor)).toEqual(['4. a', '5. b']);
  });

  it('starts a new list at an item, and continuing drops the restart again', () => {
    const editor = setup('1. a\n2. b\n3. c\n');

    act(editor, (items) => $setListItemNumber(items.b, 1));
    expect(numbers(editor)).toEqual(['1. a', '1. b', '2. c']);

    act(editor, (items) => $continueListNumbering(items.b));
    expect(numbers(editor)).toEqual(['1. a', '2. b', '3. c']);
  });

  it('does not repeat a restart on the item Enter splits off', () => {
    const editor = setup('1. a\n2. b\n');
    act(editor, (items) => $setListItemNumber(items.b, 7));

    editor.update(
      () => {
        $items().b.selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertParagraph();
          selection.insertText('c');
        }
      },
      { discrete: true },
    );

    expect(numbers(editor)).toEqual(['1. a', '7. b', '8. c']);
  });

  it('keeps a restart on each of two items in a row', () => {
    const editor = setup('1. a\n2. b\n3. c\n');

    act(editor, (items) => $setListItemNumber(items.b, 1));
    act(editor, (items) => $setListItemNumber(items.c, 1));

    expect(numbers(editor)).toEqual(['1. a', '1. b', '1. c']);
  });

  it('continues the numbering of the previous list across other blocks', () => {
    const editor = setup('1. a\n2. b\n\nbetween\n\n1. c\n2. d\n');

    expect(editor.getEditorState().read(() => $getListNumbering($items().c).canContinue)).toBe(
      true,
    );
    act(editor, (items) => $continueListNumbering(items.c));

    expect(numbers(editor)).toEqual(['1. a', '2. b', '3. c', '4. d']);
  });

  it('continues heading numbering from earlier items of the same heading level', () => {
    const editor = setup('1. ## Intro\n\nbody\n\n1. step\n2. step two\n\nmore\n\n1. ## Method\n');

    const numbering = editor.getEditorState().read(() => $getListNumbering($items().Method));
    expect(numbering).toEqual({ canContinue: true, isHeading: true, value: 1 });

    act(editor, (items) => $continueListNumbering(items.Method));

    expect(numbers(editor)).toEqual(['1. Intro', '1. step', '2. step two', '2. Method']);
  });

  it('offers nothing to continue for a first list or an item already in sequence', () => {
    const editor = setup('1. a\n2. b\n');

    const numbering = editor
      .getEditorState()
      .read(() => [$getListNumbering($items().a), $getListNumbering($items().b)]);

    expect(numbering.map((n) => n.canContinue)).toEqual([false, false]);
  });
});
