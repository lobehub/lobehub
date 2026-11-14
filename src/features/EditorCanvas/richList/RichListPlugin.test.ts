import { $isListItemNode, $isListNode, INSERT_ORDERED_LIST_COMMAND } from '@lexical/list';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getListItemHeading } from '@lobechat/editor-runtime';
import {
  CommonPlugin,
  INSERT_HEADING_COMMAND,
  Kernel,
  ListPlugin,
  MarkdownPlugin,
} from '@lobehub/editor';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { RichListPlugin } from './RichListPlugin';

// Commit pending updates, then let follow-up updates queued from update
// listeners (the markdown shortcuts) run before reading the editor state.
const flush = async (editor: LexicalEditor) => {
  await new Promise<void>((resolve) => {
    editor.update(() => undefined, { onUpdate: resolve });
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const setup = () => {
  const kernel = new Kernel();
  kernel.registerPlugins([CommonPlugin, MarkdownPlugin, ListPlugin, RichListPlugin as never]);
  const editor = kernel.initNodeEditor()!;
  return { editor, kernel };
};

// Types one character per update, the way the browser delivers keystrokes.
const type = async (editor: LexicalEditor, text: string) => {
  for (const char of text) {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(char);
    });
    await flush(editor);
  }
};

// An empty H3 with the caret in it, made the way the `/3` slash item does.
const startHeading = async (editor: LexicalEditor) => {
  editor.update(() => {
    const paragraph = $createParagraphNode();
    $getRoot().clear().append(paragraph);
    paragraph.select();
  });
  await flush(editor);
  editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h3' });
  await flush(editor);
};

const describeBlock = (node: LexicalNode): unknown => {
  if ($isHeadingNode(node)) return { heading: node.getTag(), text: node.getTextContent() };
  if ($isListNode(node))
    return {
      items: node
        .getChildren()
        .filter($isListItemNode)
        .map((item) => ({ heading: $getListItemHeading(item), text: item.getTextContent() })),
      list: node.getListType(),
    };
  return { [node.getType()]: node.getTextContent() };
};

const readBlocks = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getChildren().map(describeBlock));

describe('RichListPlugin', () => {
  it.each([
    ['- ', 'bullet'],
    ['1. ', 'number'],
    ['[ ] ', 'check'],
  ])('turns "%s" typed in a heading into a %s item of that heading level', async (marker, list) => {
    const { editor } = setup();
    await startHeading(editor);

    await type(editor, `${marker}Title`);

    expect(readBlocks(editor)).toEqual([{ items: [{ heading: 'h3', text: 'Title' }], list }]);
  });

  it('still turns "- " in a paragraph into a plain list item', async () => {
    const { editor } = setup();
    editor.update(() => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.select();
    });
    await flush(editor);

    await type(editor, '- item');

    expect(readBlocks(editor)).toEqual([
      { items: [{ heading: undefined, text: 'item' }], list: 'bullet' },
    ]);
  });

  it('keeps the heading level when the list command runs on a heading', async () => {
    const { editor } = setup();
    await startHeading(editor);
    await type(editor, 'Title');

    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    await flush(editor);

    expect(readBlocks(editor)).toEqual([
      { items: [{ heading: 'h3', text: 'Title' }], list: 'number' },
    ]);
  });

  it('gives the heading back on Backspace at the start of a heading item', async () => {
    const { editor } = setup();
    await startHeading(editor);
    await type(editor, '- Title');

    editor.update(() => {
      $getRoot().getFirstDescendant()?.selectStart();
    });
    await flush(editor);
    editor.dispatchCommand(KEY_BACKSPACE_COMMAND, new KeyboardEvent('keydown'));
    await flush(editor);

    expect(readBlocks(editor)).toEqual([{ heading: 'h3', text: 'Title' }]);
  });

  it('writes the heading level after the list marker and reads it back', async () => {
    const { kernel } = setup();
    const markdown = '1. ## Overview\n2. Details\n';

    kernel.setDocument('markdown', markdown);

    expect(readBlocks(kernel.getLexicalEditor()!)).toEqual([
      {
        items: [
          { heading: 'h2', text: 'Overview' },
          { heading: undefined, text: 'Details' },
        ],
        list: 'number',
      },
    ]);
    expect(kernel.getDocument('markdown')).toBe(markdown);
  });

  it('styles list items as headings with /3 instead of replacing the list', async () => {
    const { editor, kernel } = setup();
    kernel.setDocument('markdown', '- one\n- two\n');
    editor.update(() => {
      $getRoot().getFirstDescendant()?.selectEnd();
    });
    await flush(editor);

    editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h3' });
    await flush(editor);

    expect(readBlocks(editor)).toEqual([
      {
        items: [
          { heading: 'h3', text: 'one' },
          { heading: undefined, text: 'two' },
        ],
        list: 'bullet',
      },
    ]);
  });
});
