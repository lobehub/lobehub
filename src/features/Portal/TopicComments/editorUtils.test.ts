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

import {
  createTopicCommentMentionItems,
  createTopicCommentMentionPayload,
  insertTopicCommentMention,
  readTopicCommentEditorValue,
  resolveTopicCommentEditorContent,
  writeTopicCommentMentionMarkdown,
} from './editorUtils';

describe('topic comment editor utilities', () => {
  it('builds deduplicated mention options from active workspace members', () => {
    const items = createTopicCommentMentionItems([
      {
        user: {
          avatar: 'avatar.png',
          email: 'alice@example.com',
          fullName: 'Alice',
          username: 'alice',
        },
        userId: 'user-alice',
      },
      {
        user: { avatar: null, email: 'bob@example.com', fullName: null, username: 'bob' },
        userId: 'user-bob',
      },
      { userId: 'user-alice' },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      avatar: 'avatar.png',
      key: 'member-user-alice',
      label: 'Alice',
      metadata: {
        description: 'alice@example.com',
        id: 'user-alice',
        timestamp: 0,
        type: 'member',
      },
    });
  });

  it('serializes mention options with the shared editor format', () => {
    const option = {
      key: 'member-user-alice',
      label: 'Alice',
      metadata: { id: 'user-alice', type: 'member' },
    };

    expect(createTopicCommentMentionPayload(option)).toEqual({
      label: 'Alice',
      metadata: option.metadata,
    });
    expect(writeTopicCommentMentionMarkdown(option)).toBe(
      '<mention name="Alice" id="user-alice" />',
    );
  });

  it('keeps a text caret after an inserted mention so typing can continue', async () => {
    const lexicalEditor = createEditor();
    await new Promise<void>((resolve) => {
      lexicalEditor.update(
        () => {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode('mention'));
          $getRoot().append(paragraph);
          paragraph.selectEnd();
        },
        { onUpdate: resolve },
      );
    });

    const focus = vi.fn();
    const dispatchCommand = vi.fn();
    const editor = {
      dispatchCommand,
      focus,
      getLexicalEditor: () => lexicalEditor,
    } as unknown as IEditor;
    const option = {
      key: 'member-user-alice',
      label: 'Alice',
      metadata: { id: 'user-alice', type: 'member' },
    };

    insertTopicCommentMention(editor, option);

    await new Promise<void>((resolve) => {
      lexicalEditor.update(() => undefined, { onUpdate: resolve });
    });

    let caret: { offset: number; type: string } | undefined;
    let text = '';
    lexicalEditor.getEditorState().read(() => {
      const selection = $getSelection();
      text = $getRoot().getTextContent();
      if ($isRangeSelection(selection)) {
        caret = { offset: selection.anchor.offset, type: selection.anchor.type };
      }
    });

    expect(text).toBe('mention ');
    expect(caret).toEqual({ offset: 8, type: 'text' });
    expect(focus).toHaveBeenCalledOnce();
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.anything(),
      createTopicCommentMentionPayload(option),
    );
  });

  it('reads markdown and JSON from the editor for create and edit flows', () => {
    const editorData = {
      root: {
        children: [{ message: undefined, size: undefined, type: 'file', url: '/file.pdf' }],
      },
    };
    const editor = {
      getDocument: vi.fn((type: 'json' | 'markdown') =>
        type === 'json' ? editorData : 'Draft comment',
      ),
    } as unknown as IEditor;

    expect(readTopicCommentEditorValue(editor)).toEqual({
      content: 'Draft comment',
      editorData: {
        root: { children: [{ type: 'file', url: '/file.pdf' }] },
      },
    });
  });

  it('selects the correct editor data source for empty, markdown, and rich-text content', () => {
    const editorData = { root: { children: [] } };

    expect(resolveTopicCommentEditorContent('', null)).toEqual({ content: '', type: 'text' });
    expect(resolveTopicCommentEditorContent('Draft', null)).toEqual({
      content: 'Draft',
      type: 'markdown',
    });
    expect(resolveTopicCommentEditorContent('ignored', editorData)).toEqual({
      content: editorData,
      type: 'json',
    });
  });
});
