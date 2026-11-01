import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { selectEditorStartLineOnLexical } from './focusEditorStartLine';

const flush = async (editor: LexicalEditor) => {
  await new Promise<void>((resolve) => {
    editor.update(() => undefined, { onUpdate: resolve });
  });
};

const createTestEditor = () =>
  createEditor({
    onError: (e) => {
      throw e;
    },
  });

const readSnapshot = (editor: LexicalEditor) => {
  let lines: string[] = [];
  let caretLine: number | undefined;
  editor.getEditorState().read(() => {
    lines = $getRoot()
      .getChildren()
      .map((child) => child.getTextContent());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      caretLine = selection.anchor.getNode().getTopLevelElementOrThrow().getIndexWithinParent();
    }
  });
  return { caretLine, lines };
};

describe('selectEditorStartLineOnLexical', () => {
  it('opens an empty line above existing content and puts the caret on it', async () => {
    const editor = createTestEditor();
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('body')));
    });
    await flush(editor);

    selectEditorStartLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, lines: ['', 'body'] });
  });

  it('reuses an empty first line instead of stacking another one', async () => {
    const editor = createTestEditor();
    editor.update(() => {
      $getRoot().append(
        $createParagraphNode(),
        $createParagraphNode().append($createTextNode('body')),
      );
    });
    await flush(editor);

    selectEditorStartLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, lines: ['', 'body'] });
  });

  it('gives an empty document a line to type on', async () => {
    const editor = createTestEditor();

    selectEditorStartLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, lines: [''] });
  });
});
