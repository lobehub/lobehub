import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import { $isActionTagNode, ActionTagNode } from './ActionTagNode';
import { insertGoalTag } from './goalTag';
import { GOAL_COMMAND_TYPE } from './types';

const LABEL = 'Set goal';

const createTestEditor = () => {
  const lexicalEditor = createEditor({
    nodes: [ActionTagNode],
    onError: (error) => {
      throw error;
    },
  });

  const editor = {
    focus: vi.fn(),
    getLexicalEditor: () => lexicalEditor,
  } as unknown as IEditor;

  return { editor, lexicalEditor };
};

const seedParagraph = (lexicalEditor: ReturnType<typeof createEditor>, text: string) => {
  lexicalEditor.update(
    () => {
      const paragraph = $createParagraphNode();
      if (text) paragraph.append($createTextNode(text));
      $getRoot().append(paragraph);
    },
    { discrete: true },
  );
};

/** The document's inline nodes, flattened to `[type, textContent]` pairs. */
const readInlineNodes = (lexicalEditor: ReturnType<typeof createEditor>) =>
  lexicalEditor.read(() =>
    $getRoot()
      .getFirstChild<any>()
      ?.getChildren()
      .map((node: any) => [
        $isActionTagNode(node) ? node.actionType : node.getType(),
        node.getTextContent(),
      ]),
  );

/** Type at the current caret, the way the user's next keystroke would. */
const typeAtCaret = (lexicalEditor: ReturnType<typeof createEditor>, text: string) => {
  lexicalEditor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error('no caret to type at');
      selection.insertText(text);
    },
    { discrete: true },
  );
};

describe('insertGoalTag', () => {
  it('leaves the caret behind the chip so the typed goal stays behind the marker', () => {
    const { editor, lexicalEditor } = createTestEditor();
    // An empty composer is what the slash path leaves once the plugin has removed
    // the `/goal` query text.
    seedParagraph(lexicalEditor, '');

    insertGoalTag(editor, LABEL);
    typeAtCaret(lexicalEditor, 'ship the homepage');

    // Regression: the caret used to stay at the block start, in front of the
    // chip, so the goal the user typed landed BEFORE the marker — serializing to
    // `ship the homepage/goal ` and silently destroying the `/goal` prefix that
    // makes it a goal turn at all.
    expect(readInlineNodes(lexicalEditor)).toEqual([
      [GOAL_COMMAND_TYPE, LABEL],
      ['text', 'ship the homepage'],
    ]);
  });

  it('keeps a caret that is already behind the chip where the user left it', () => {
    const { editor, lexicalEditor } = createTestEditor();
    seedParagraph(lexicalEditor, 'ship the homepage');
    // The `+` menu path: the user stopped typing at the end of their sentence.
    lexicalEditor.update(
      () => {
        ($getRoot().getFirstChild() as any).selectEnd();
      },
      { discrete: true },
    );

    insertGoalTag(editor, LABEL);
    typeAtCaret(lexicalEditor, ' now');

    expect(readInlineNodes(lexicalEditor)).toEqual([
      [GOAL_COMMAND_TYPE, LABEL],
      ['text', 'ship the homepage now'],
    ]);
  });

  it('leads the message with the goal chip instead of dropping it at the caret', () => {
    const { editor, lexicalEditor } = createTestEditor();
    seedParagraph(lexicalEditor, 'ship the homepage');

    insertGoalTag(editor, LABEL);

    // The chip serializes back to the `/goal ` prefix, and both the client tool
    // gate and the server system role only accept it at the head of the message.
    expect(readInlineNodes(lexicalEditor)).toEqual([
      [GOAL_COMMAND_TYPE, LABEL],
      ['text', 'ship the homepage'],
    ]);
    expect(editor.focus).toHaveBeenCalled();
  });

  it('works when called from inside an ongoing editor update', () => {
    const { editor, lexicalEditor } = createTestEditor();
    seedParagraph(lexicalEditor, '');

    // Regression: the slash menu runs `onSelect` inside its own
    // `lexicalEditor.update()`, and the previous implementation cleared the
    // document there — which threw ("the editor state is empty") and aborted the
    // whole update, so pressing Enter on `/goal` did nothing at all.
    lexicalEditor.update(
      () => {
        insertGoalTag(editor, LABEL);
      },
      { discrete: true },
    );

    expect(readInlineNodes(lexicalEditor)).toEqual([[GOAL_COMMAND_TYPE, LABEL]]);
  });

  it('keeps whatever the user already typed', () => {
    const { editor, lexicalEditor } = createTestEditor();
    seedParagraph(lexicalEditor, 'ship the homepage');

    insertGoalTag(editor, LABEL);

    expect(lexicalEditor.read(() => $getRoot().getTextContent())).toContain('ship the homepage');
  });

  it('inserts at most one chip per message', () => {
    const { editor, lexicalEditor } = createTestEditor();
    seedParagraph(lexicalEditor, 'ship the homepage');

    insertGoalTag(editor, LABEL);
    insertGoalTag(editor, LABEL);

    // A second chip would serialize a second `/goal ` into the prompt.
    expect(readInlineNodes(lexicalEditor)).toEqual([
      [GOAL_COMMAND_TYPE, LABEL],
      ['text', 'ship the homepage'],
    ]);
  });

  it('prepends a paragraph when the draft starts with a block-children container', () => {
    const { editor, lexicalEditor } = createTestEditor();
    // A list / table shape: an ElementNode whose children are blocks, not inline
    // content. Prepending the chip straight into it would break that container's
    // child contract and could move the chip off the head of the message.
    lexicalEditor.update(
      () => {
        const container = $createParagraphNode();
        const innerBlock = $createParagraphNode();
        innerBlock.append($createTextNode('ship the homepage'));
        container.append(innerBlock);
        $getRoot().append(container);
      },
      { discrete: true },
    );

    insertGoalTag(editor, LABEL);

    const blocks = lexicalEditor.read(() =>
      $getRoot()
        .getChildren()
        .map((block: any) => block.getChildren().map((child: any) => child.getType())),
    );
    // The chip leads the document in its own paragraph, ahead of the container.
    expect(blocks[0]).toEqual([ActionTagNode.getType()]);
    expect(blocks).toHaveLength(2);
  });

  it('does nothing without an editor', () => {
    expect(() => insertGoalTag(undefined, LABEL)).not.toThrow();
  });
});
