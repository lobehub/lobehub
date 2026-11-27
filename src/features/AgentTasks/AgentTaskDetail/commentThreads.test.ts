import type { TaskDetailActivity } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupCommentThreads } from './commentThreads';
import { sliceActivityPage } from './useActivityPaging';

const comment = (id: string, time: string, parentCommentId?: string): TaskDetailActivity => ({
  content: id,
  id,
  parentCommentId,
  time,
  type: 'comment',
});

const time = (minute: number) => `2026-11-27T10:${String(minute).padStart(2, '0')}:00Z`;

describe('groupCommentThreads', () => {
  it('keeps roots in their original positions among lifecycle entries without reply bumps', () => {
    const root = comment('root', time(1));
    const event: TaskDetailActivity = { id: 'event', time: time(2), type: 'created' };
    const newer = comment('newer', time(3));
    const groups = groupCommentThreads([root, event, newer, comment('reply', time(4), 'root')]);

    expect(groups.map(({ activity }) => activity.id)).toEqual(['root', 'event', 'newer']);
    expect(groups[0].replies.map(({ id }) => id)).toEqual(['reply']);
    expect(groups[1].replies).toEqual([]);
  });

  it('sorts replies oldest first even when their flat source order differs', () => {
    const groups = groupCommentThreads([
      comment('late', time(5), 'root'),
      comment('root', time(1)),
      comment('early', time(2), 'root'),
      comment('same-time', time(2), 'root'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].replies.map(({ id }) => id)).toEqual(['early', 'same-time', 'late']);
  });

  it('keeps orphan and invalid-parent comments visible without attaching them to lifecycle rows', () => {
    const event: TaskDetailActivity = { id: 'event', type: 'created' };
    const groups = groupCommentThreads([
      event,
      comment('orphan', time(1), 'missing'),
      comment('invalid', time(2), 'event'),
      comment('self', time(3), 'self'),
    ]);

    expect(groups.map(({ activity }) => activity.id)).toEqual([
      'event',
      'orphan',
      'invalid',
      'self',
    ]);
    expect(groups.every(({ replies }) => replies.length === 0)).toBe(true);
  });

  it('pages whole threads rather than splitting optimistic replies from their roots', () => {
    const groups = groupCommentThreads([
      comment('root', time(1)),
      comment('optimistic-comment', time(4), 'root'),
      comment('second', time(3)),
    ]).reverse();

    const page = sliceActivityPage(groups, 2);
    expect(page.remaining).toBe(0);
    expect(page.visible.map(({ activity }) => activity.id)).toEqual(['second', 'root']);
    expect(page.visible[1].replies[0].id).toBe('optimistic-comment');
  });
});
