import { $isListItemNode, $isListNode } from '@lexical/list';
import { CommonPlugin, type IEditor, Kernel, ListPlugin, MarkdownPlugin } from '@lobehub/editor';
import { $getNodeByKey, $getRoot, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import { onListNumberMenuRequest, requestListNumberMenu } from './numberMenuRequest';
import { RichListPlugin } from './RichListPlugin';

const flush = async (editor: LexicalEditor) => {
  await new Promise<void>((resolve) => {
    editor.update(() => undefined, { onUpdate: resolve });
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

// An editor holding `markdown`, with the caret at the end of the block whose text is `caretIn`.
const setup = async (markdown: string, caretIn: string) => {
  const kernel = new Kernel();
  kernel.registerPlugins([CommonPlugin, MarkdownPlugin, ListPlugin, RichListPlugin as never]);
  const lexical = kernel.initNodeEditor()!;
  kernel.setDocument('markdown', markdown);
  lexical.update(() => {
    $getRoot()
      .getAllTextNodes()
      .find((node) => node.getTextContent() === caretIn)
      ?.selectEnd();
  });
  await flush(lexical);

  const editor = kernel as unknown as IEditor;
  const requested: string[] = [];
  onListNumberMenuRequest(editor, (key) => requested.push(key));

  // What each requested key points at: the item's text and its list type.
  const describeRequests = () =>
    lexical.getEditorState().read(() =>
      requested.map((key) => {
        const item = $getNodeByKey(key);
        const list = item?.getParent();
        return $isListItemNode(item) && $isListNode(list)
          ? `${list.getListType()}: ${item.getTextContent()}`
          : 'not a list item';
      }),
    );

  return { describeRequests, editor, lexical };
};

describe('requestListNumberMenu', () => {
  it('opens the menu on the numbered item the caret is in', async () => {
    const { describeRequests, editor, lexical } = await setup('1. a\n2. b\n3. c\n', 'b');

    requestListNumberMenu(editor);
    await flush(lexical);

    expect(describeRequests()).toEqual(['number: b']);
  });

  it('makes a paragraph a numbered item first, then opens the menu on it', async () => {
    const { describeRequests, editor, lexical } = await setup('intro\n\nbody\n', 'body');

    requestListNumberMenu(editor);
    await flush(lexical);

    expect(describeRequests()).toEqual(['number: body']);
  });

  it('opens on the nested numbered item, not on the item wrapping it', async () => {
    const { describeRequests, editor, lexical } = await setup('1. a\n   1. inner\n2. b\n', 'inner');

    requestListNumberMenu(editor);
    await flush(lexical);

    expect(describeRequests()).toEqual(['number: inner']);
  });

  it('stops notifying a menu that unsubscribed', async () => {
    const { editor, lexical } = await setup('1. a\n', 'a');
    const requested: string[] = [];
    const unsubscribe = onListNumberMenuRequest(editor, (key) => requested.push(key));
    unsubscribe();

    requestListNumberMenu(editor);
    await flush(lexical);

    expect(requested).toEqual([]);
  });
});
