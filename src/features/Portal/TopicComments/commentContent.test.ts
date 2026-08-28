import { describe, expect, it } from 'vitest';

import { createTopicCommentUpdateInput, hasTopicCommentEditorData } from './commentContent';

describe('hasTopicCommentEditorData', () => {
  it('recognizes persisted rich-text editor data', () => {
    expect(hasTopicCommentEditorData({ root: { children: [] } })).toBe(true);
    expect(hasTopicCommentEditorData({})).toBe(false);
    expect(hasTopicCommentEditorData(null)).toBe(false);
    expect(hasTopicCommentEditorData([])).toBe(false);
  });
});

describe('createTopicCommentUpdateInput', () => {
  it('preserves member mention data and trims the submitted markdown', () => {
    const editorData = {
      root: {
        children: [
          {
            label: 'Member',
            metadata: { id: 'member-1', type: 'member' },
            type: 'mention',
          },
        ],
      },
    };

    expect(
      createTopicCommentUpdateInput('comment-1', {
        content: '  Hello <mention name="Member" id="member-1" />  ',
        editorData,
      }),
    ).toEqual({
      content: 'Hello <mention name="Member" id="member-1" />',
      editorData,
      id: 'comment-1',
    });
  });
});
