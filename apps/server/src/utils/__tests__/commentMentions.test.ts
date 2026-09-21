import { describe, expect, it } from 'vitest';

import { extractMentionedUserIds } from '../commentMentions';

const mention = (id: unknown, type = 'member') => ({
  label: 'Alex',
  metadata: { id, type },
  type: 'mention',
});

describe('extractMentionedUserIds', () => {
  it('returns member mention ids from nested editor nodes, deduplicated', () => {
    const editorData = {
      root: {
        children: [
          { children: [{ text: 'hi ' }, mention('user-1')], type: 'paragraph' },
          { children: [mention('user-2'), mention('user-1')], type: 'paragraph' },
        ],
      },
    };

    expect(extractMentionedUserIds(editorData)).toEqual(['user-1', 'user-2']);
  });

  it('ignores non-member mentions, empty ids and malformed input', () => {
    const editorData = {
      root: {
        children: [mention('agent-1', 'agent'), mention(''), mention(42), { type: 'text' }, null],
      },
    };

    expect(extractMentionedUserIds(editorData)).toEqual([]);
    expect(extractMentionedUserIds(undefined)).toEqual([]);
    expect(extractMentionedUserIds('not-json')).toEqual([]);
    expect(extractMentionedUserIds({ root: null })).toEqual([]);
  });
});
