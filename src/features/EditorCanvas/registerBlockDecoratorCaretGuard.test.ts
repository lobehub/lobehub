import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { registerBlockDecoratorCaretGuardOnLexical } from './registerBlockDecoratorCaretGuard';

class FakeBlockNode extends DecoratorNode<null> {
  static getType() {
    return 'fake-block';
  }

  static clone(node: FakeBlockNode) {
    return new FakeBlockNode(node.__key);
  }

  static importJSON() {
    return new FakeBlockNode();
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

const $isFakeBlock = (node: LexicalNode | null | undefined): node is FakeBlockNode =>
  node instanceof FakeBlockNode;

// Commit the pending update, then let the guard's follow-up update (queued from
// the update listener) run before we read the editor state.
const flush = async (editor: LexicalEditor) => {
  await new Promise<void>((resolve) => {
    editor.update(() => undefined, { onUpdate: resolve });
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const createGuardedEditor = () => {
  const editor = createEditor({
    nodes: [FakeBlockNode],
    onError: (e) => {
      throw e;
    },
  });
  registerBlockDecoratorCaretGuardOnLexical(editor);
  return editor;
};

const readSnapshot = (editor: LexicalEditor) => {
  let childTypes: string[] = [];
  let caretParentType: string | undefined;
  let caretIndex: number | undefined;
  editor.getEditorState().read(() => {
    const root = $getRoot();
    childTypes = root.getChildren().map((child) => child.getType());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      caretParentType = anchorNode.getType();
      caretIndex = anchorNode.getIndexWithinParent();
    }
  });
  return { caretIndex, caretParentType, childTypes };
};

describe('registerBlockDecoratorCaretGuard', () => {
  it('pushes an empty paragraph after a trailing block decorator and moves the caret into it', async () => {
    const editor = createGuardedEditor();

    editor.update(() => {
      const root = $getRoot();
      const block = new FakeBlockNode();
      root.append(block);
      // Mirrors Lexical's insertNodes: decorator.selectEnd() → root.select()
      block.selectEnd();
    });
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({
      caretIndex: 1,
      caretParentType: 'paragraph',
      childTypes: ['fake-block', 'paragraph'],
    });
  });

  it('pushes an empty paragraph before a leading block decorator when the caret lands at root offset 0', async () => {
    const editor = createGuardedEditor();

    editor.update(() => {
      const root = $getRoot();
      root.append(new FakeBlockNode());
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('after'));
      root.append(paragraph);
      // Mirrors clicking left of the first-line image: DOM point → root offset 0
      root.select(0, 0);
    });
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({
      caretIndex: 0,
      caretParentType: 'paragraph',
      childTypes: ['paragraph', 'fake-block', 'paragraph'],
    });
  });

  it('inserts a paragraph between two adjacent block decorators', async () => {
    const editor = createGuardedEditor();

    editor.update(() => {
      const root = $getRoot();
      root.append(new FakeBlockNode(), new FakeBlockNode());
      root.select(1, 1);
    });
    await flush(editor);

    expect(readSnapshot(editor)).toEqual({
      caretIndex: 1,
      caretParentType: 'paragraph',
      childTypes: ['fake-block', 'paragraph', 'fake-block'],
    });
  });

  it('reuses an adjacent paragraph instead of inserting a new one', async () => {
    const editor = createGuardedEditor();

    editor.update(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('before'));
      root.append(paragraph, new FakeBlockNode());
      // Root point right after the paragraph, before the decorator
      root.select(1, 1);
    });
    await flush(editor);

    let anchorText = '';
    let anchorOffset = -1;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        anchorText = selection.anchor.getNode().getTextContent();
        anchorOffset = selection.anchor.offset;
      }
    });

    expect(readSnapshot(editor).childTypes).toEqual(['paragraph', 'fake-block']);
    expect(anchorText).toBe('before');
    expect(anchorOffset).toBe('before'.length);
  });

  it('leaves a normal paragraph caret untouched', async () => {
    const editor = createGuardedEditor();

    editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('hello'));
      $getRoot().append(paragraph);
      paragraph.selectEnd();
    });
    await flush(editor);

    expect(readSnapshot(editor).childTypes).toEqual(['paragraph']);
  });

  it('does nothing when the editor is not editable', async () => {
    const editor = createGuardedEditor();
    editor.setEditable(false);

    editor.update(() => {
      const root = $getRoot();
      const block = new FakeBlockNode();
      root.append(block);
      block.selectEnd();
    });
    await flush(editor);

    const { childTypes } = readSnapshot(editor);
    expect(childTypes).toEqual(['fake-block']);
    editor.getEditorState().read(() => {
      expect($isFakeBlock($getRoot().getFirstChild())).toBe(true);
    });
  });
});
