import { describe, expect, it } from 'vitest';

import { diffAddedMentionUserIds } from '../documentMentions';

const mention = (id: string, type = 'member') => ({
  label: id,
  metadata: { id, type },
  type: 'mention',
});

const doc = (...nodes: unknown[]) => ({
  root: { children: [{ children: nodes, type: 'paragraph' }], type: 'root' },
});

describe('diffAddedMentionUserIds', () => {
  it('returns only member mentions that are new in the next snapshot', () => {
    const previous = doc({ text: 'hi ' }, mention('user-1'));
    const next = doc({ text: 'hi ' }, mention('user-1'), mention('user-2'), mention('user-2'));

    expect(diffAddedMentionUserIds(previous, next)).toEqual(['user-2']);
  });

  it('treats every mention as new when there is no previous snapshot', () => {
    expect(diffAddedMentionUserIds(undefined, doc(mention('user-1')))).toEqual(['user-1']);
    expect(diffAddedMentionUserIds({}, doc(mention('user-1')))).toEqual(['user-1']);
  });

  it('returns nothing when mentions are unchanged or removed', () => {
    const previous = doc(mention('user-1'), mention('user-2'));

    expect(diffAddedMentionUserIds(previous, doc(mention('user-1'), mention('user-2')))).toEqual(
      [],
    );
    expect(diffAddedMentionUserIds(previous, doc(mention('user-1')))).toEqual([]);
    expect(diffAddedMentionUserIds(previous, doc())).toEqual([]);
  });

  it('counts a mention removed earlier and added again as new', () => {
    expect(diffAddedMentionUserIds(doc(), doc(mention('user-1')))).toEqual(['user-1']);
  });

  it('ignores non-member mentions', () => {
    expect(diffAddedMentionUserIds(doc(), doc(mention('agent-1', 'agent')))).toEqual([]);
  });
});
