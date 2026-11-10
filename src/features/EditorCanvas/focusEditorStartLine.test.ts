import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  DecoratorNode,
  type LexicalEditor,
  type ParagraphNode,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import {
  focusEditorFirstLine,
  focusEditorStartLine,
  selectEditorFirstLineOnLexical,
  selectEditorStartLineOnLexical,
} from './focusEditorStartLine';

const flush = async (editor: LexicalEditor) => {
  await new Promise<void>((resolve) => {
    editor.update(() => undefined, { onUpdate: resolve });
  });
};

class FakeImageNode extends DecoratorNode<null> {
  static getType() {
    return 'fake-image';
  }

  static clone(node: FakeImageNode) {
    return new FakeImageNode(node.__key);
  }

  static importJSON() {
    return new FakeImageNode();
  }

  isInline() {
    return false;
  }

  createDOM() {
    return document.createElement('div');
  }

  updateDOM() {
    return false;
  }

  decorate() {
    return null;
  }
}

const createTestEditor = () =>
  createEditor({
    nodes: [FakeImageNode],
    onError: (e) => {
      throw e;
    },
  });

const readSnapshot = (editor: LexicalEditor) => {
  let lines: string[] = [];
  let caretLine: number | undefined;
  let caretOffset: number | undefined;
  editor.getEditorState().read(() => {
    lines = $getRoot()
      .getChildren()
      .map((child) => child.getTextContent());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      caretLine = selection.anchor.getNode().getTopLevelElementOrThrow().getIndexWithinParent();
      caretOffset = selection.anchor.offset;
    }
  });
  return { caretLine, caretOffset, lines };
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

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, caretOffset: 0, lines: ['', 'body'] });
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

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, caretOffset: 0, lines: ['', 'body'] });
  });

  it('gives an empty document a line to type on', async () => {
    const editor = createTestEditor();

    selectEditorStartLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, caretOffset: 0, lines: [''] });
  });
});

describe('selectEditorStartLineOnLexical with text split off the title', () => {
  it('puts the text on a new first line above the body, caret at its start', async () => {
    const editor = createTestEditor();
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('body')));
    });
    await flush(editor);

    selectEditorStartLineOnLexical(editor, ' world');
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({
      caretLine: 0,
      caretOffset: 0,
      lines: [' world', 'body'],
    });
  });

  it('does not write the text into an empty first line that is already there', async () => {
    const editor = createTestEditor();
    editor.update(() => {
      $getRoot().append(
        $createParagraphNode(),
        $createParagraphNode().append($createTextNode('body')),
      );
    });
    await flush(editor);

    selectEditorStartLineOnLexical(editor, 'tail');
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({
      caretLine: 0,
      caretOffset: 0,
      lines: ['tail', '', 'body'],
    });
  });
});

describe('selectEditorFirstLineOnLexical', () => {
  it('moves the caret to the start of the first text block without adding a line', async () => {
    const editor = createTestEditor();
    editor.update(() => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('first')),
        $createParagraphNode().append($createTextNode('body')),
      );
      $getRoot().getLastChildOrThrow<ParagraphNode>().selectEnd();
    });
    await flush(editor);

    selectEditorFirstLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({
      caretLine: 0,
      caretOffset: 0,
      lines: ['first', 'body'],
    });
  });

  it('opens a line above a block image the body starts with', async () => {
    const editor = createTestEditor();
    editor.update(() => {
      $getRoot().append(
        new FakeImageNode(),
        $createParagraphNode().append($createTextNode('body')),
      );
    });
    await flush(editor);

    selectEditorFirstLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, caretOffset: 0, lines: ['', '', 'body'] });
  });

  it('gives an empty document a line to stand on', async () => {
    const editor = createTestEditor();

    selectEditorFirstLineOnLexical(editor);
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({ caretLine: 0, caretOffset: 0, lines: [''] });
  });
});

describe('focusEditorStartLine / focusEditorFirstLine', () => {
  const setupKernel = async ({ editable = true, mounted = true } = {}) => {
    const lexical = createTestEditor();
    if (mounted) {
      const root = document.createElement('div');
      root.contentEditable = 'true';
      document.body.append(root);
      lexical.setRootElement(root);
    }
    lexical.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('body')));
    });
    await flush(lexical);
    lexical.setEditable(editable);

    const focus = vi.fn();
    const editor = { focus, getLexicalEditor: () => lexical } as unknown as IEditor;
    return { editor, focus, lexical };
  };

  it('writes the split-off title text into a mounted, editable body', async () => {
    const { editor, focus, lexical } = await setupKernel();

    focusEditorStartLine(editor, 'tail');
    await flush(lexical);

    expect(readSnapshot(lexical).lines).toEqual(['tail', 'body']);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  // While the body is loading the kernel can hold a detached editor whose
  // content is about to be replaced: text written there would be lost.
  it('leaves a body that is not mounted yet untouched', async () => {
    const { editor, focus, lexical } = await setupKernel({ mounted: false });

    focusEditorStartLine(editor, 'tail');
    focusEditorFirstLine(editor);
    await flush(lexical);

    expect(readSnapshot(lexical).lines).toEqual(['body']);
    expect(focus).not.toHaveBeenCalled();
  });

  it('leaves a read-only body untouched', async () => {
    const { editor, focus, lexical } = await setupKernel({ editable: false });

    focusEditorStartLine(editor, 'tail');
    await flush(lexical);

    expect(readSnapshot(lexical).lines).toEqual(['body']);
    expect(focus).not.toHaveBeenCalled();
  });

  it('does nothing before the kernel has a Lexical editor', () => {
    const focus = vi.fn();
    const editor = { focus, getLexicalEditor: () => null } as unknown as IEditor;

    focusEditorStartLine(editor, 'tail');
    focusEditorFirstLine(editor);

    expect(focus).not.toHaveBeenCalled();
  });
});
