import type { TaskDetailActivity, TaskDetailData } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  TASK_DETAIL_COMMENT_BODY_COUNT,
  TASK_DETAIL_COMMENT_BODY_LIMIT,
} from './formatTaskComments';
import { formatTaskComment, formatTaskDetail } from './index';

const ledger = [
  '## 去重台账',
  '- #101 已处理（PR #2001）',
  '- #102 已处理（PR #2002）',
  '- #103 跳过：重复于 #101，原因是同一个根因在不同入口触发',
].join('\n');

const task = (activities: TaskDetailActivity[]): TaskDetailData => ({
  activities,
  id: 'task_1',
  identifier: 'T-2670',
  instruction: '每轮先读历史评论里的去重台账',
  name: 'Patrol',
  status: 'running',
});

const comment = (id: string, content: string, time: string): TaskDetailActivity => ({
  agentId: 'agt_1',
  author: { id: 'agt_1', name: 'Patrol Bot', type: 'agent' },
  content,
  id,
  time,
  type: 'comment',
});

describe('formatTaskDetail comment bodies', () => {
  it('prints the full comment body with author and time instead of an 80-char title', () => {
    const out = formatTaskDetail(task([comment('cmt_ledger', ledger, '2026-11-04T01:02:00.000Z')]));

    expect(out).toContain('💭 2026-11-04T01:02:00.000Z 🤖 agent Patrol Bot  cmt_ledger');
    for (const line of ledger.split('\n')) expect(out).toContain(`      ${line}`);
    expect(out).not.toContain('[truncated');
  });

  it('caps a long body and points at the commentId continuation path', () => {
    const long = 'x'.repeat(TASK_DETAIL_COMMENT_BODY_LIMIT + 500);
    const out = formatTaskDetail(task([comment('cmt_long', long, '2026-11-04T01:02:00.000Z')]));

    expect(out).not.toContain(long);
    expect(out).toContain(
      `[truncated, ${long.length} chars total — read it with viewTask({ identifier: "T-2670", commentId: "cmt_long" })]`,
    );
  });

  it('keeps comments older than the newest window as one-line previews', () => {
    const comments = Array.from({ length: TASK_DETAIL_COMMENT_BODY_COUNT + 1 }, (_, i) =>
      comment(
        `cmt_${i}`,
        `round ${i}\n${'detail '.repeat(20)}`,
        `2026-11-04T${String(i).padStart(2, '0')}:00:00.000Z`,
      ),
    );
    const out = formatTaskDetail(task(comments));

    // cmt_0 is the oldest: preview only, on one line; the read-in-full hint is said once.
    const oldest = out.split('\n').find((l) => l.includes('cmt_0'))!;
    expect(oldest).toContain('round 0 detail');
    expect(oldest).not.toContain('commentId');
    expect(out).toContain('(1 older comment shown as one-line previews; pass viewTask commentId');
    expect(out).not.toContain('      round 0');
    expect(out).toContain('      round 1');
  });
});

describe('formatTaskComment', () => {
  it('returns the complete body with author and time', () => {
    const long = `${ledger}\n${'y'.repeat(TASK_DETAIL_COMMENT_BODY_LIMIT * 2)}`;
    const out = formatTaskComment(
      task([comment('cmt_ledger', long, '2026-11-04T01:02:00.000Z')]),
      'cmt_ledger',
    );

    expect(out).toContain('Comment cmt_ledger on T-2670');
    expect(out).toContain('Author: 🤖 agent Patrol Bot');
    expect(out).toContain('Time: 2026-11-04T01:02:00.000Z');
    expect(out).toContain(long);
  });

  it('returns undefined for an id that is not a comment on the task', () => {
    expect(formatTaskComment(task([]), 'cmt_missing')).toBeUndefined();
  });
});
