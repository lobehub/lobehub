import type { TaskDetailActivity } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupCommentThreads } from './commentThreads';

const comment = (id: string, time: string, parentCommentId?: string): TaskDetailActivity => ({
  content: id,
  id,
  parentCommentId: parentCommentId ?? null,
  time,
  type: 'comment',
});

describe('groupCommentThreads', () => {
  it('moves replies into their thread, oldest first, and keeps the feed order', () => {
    const created: TaskDetailActivity = {
      id: 'created',
      time: '2026-01-01T00:00:00Z',
      type: 'created',
    };
    const root = comment('root', '2026-01-01T00:01:00Z');
    const later = comment('reply-2', '2026-01-01T00:05:00Z', 'root');
    const earlier = comment('reply-1', '2026-01-01T00:02:00Z', 'root');
    const other = comment('other', '2026-01-01T00:03:00Z');

    const { repliesByRootId, topLevel } = groupCommentThreads([
      created,
      root,
      later,
      other,
      earlier,
    ]);

    expect(topLevel.map((a) => a.id)).toEqual(['created', 'root', 'other']);
    expect(repliesByRootId.get('root')?.map((a) => a.id)).toEqual(['reply-1', 'reply-2']);
    expect(repliesByRootId.has('other')).toBe(false);
  });

  it('keeps a reply whose root is not in the feed as a top-level row', () => {
    const orphan = comment('orphan', '2026-01-01T00:02:00Z', 'missing-root');

    const { repliesByRootId, topLevel } = groupCommentThreads([orphan]);

    expect(topLevel).toEqual([orphan]);
    expect(repliesByRootId.size).toBe(0);
  });
});
