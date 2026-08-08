import type { IEditor } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import {
  createTopicCommentMentionItems,
  createTopicCommentMentionPayload,
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

  it('reads markdown and JSON from the editor for create and edit flows', () => {
    const editorData = { root: { children: [] } };
    const editor = {
      getDocument: vi.fn((type: 'json' | 'markdown') =>
        type === 'json' ? editorData : 'Draft comment',
      ),
    } as unknown as IEditor;

    expect(readTopicCommentEditorValue(editor)).toEqual({
      content: 'Draft comment',
      editorData,
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
