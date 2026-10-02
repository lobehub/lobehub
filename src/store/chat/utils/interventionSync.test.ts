import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  hasPendingInterventions,
  reconcileIntervention,
  reconcileStreamingInterventions,
} from './interventionSync';

const question = (
  status: 'pending' | 'approved' | 'rejected' | 'aborted',
  updatedAt = 1,
): UIChatMessage => ({
  id: 'question',
  content: status === 'pending' ? '' : 'User submitted: answer',
  createdAt: 1,
  updatedAt,
  role: 'tool',
  tool_call_id: 'call-1',
  pluginIntervention: { status },
});

describe('cross-device intervention reconciliation', () => {
  it('settles an existing Ask and adds unseen rows without replacing streamed content', () => {
    const pending = question('pending', 10);
    const answered = question('approved', 1);
    const streamed: UIChatMessage = {
      id: 'assistant',
      role: 'assistant',
      content: 'live text',
      createdAt: 2,
      updatedAt: 10,
    };
    const unseen: UIChatMessage = {
      id: 'member-tool',
      role: 'tool',
      content: '',
      createdAt: 3,
      updatedAt: 10,
    };
    expect(
      reconcileStreamingInterventions(
        [pending, streamed],
        [answered, { ...streamed, content: '...' }, unseen],
      ),
    ).toEqual([answered, streamed, unseen]);
  });

  it('preserves the array when a fetch has no intervention changes', () => {
    const local = [question('pending')];
    expect(reconcileStreamingInterventions(local, [question('pending')])).toBe(local);
    expect(reconcileStreamingInterventions(local, [])).toBe(local);
  });

  it('reopens a newer rolled-back question while preserving streaming assistant rows', () => {
    const answered = question('approved', 10);
    const rollback = question('pending', 11);
    const assistant: UIChatMessage = {
      id: 'assistant',
      role: 'assistant',
      content: 'live text',
      createdAt: 1,
      updatedAt: 10,
    };
    const merged = reconcileStreamingInterventions(
      [answered, assistant],
      [rollback, { ...assistant, content: '...' }],
    );
    expect(merged[0]).toBe(rollback);
    expect(merged[1]).toBe(assistant);
  });
  it.each(['approved', 'rejected', 'aborted'] as const)(
    'accepts a remote %s without a message timestamp change',
    (status) => {
      const pending = question('pending', 10);
      const answered = question(status, 1);
      expect(hasPendingInterventions([pending])).toBe(true);
      expect(reconcileIntervention(pending, answered)).toBe(answered);
      expect(hasPendingInterventions([answered])).toBe(false);
    },
  );

  it('allows authoritative rollback instead of treating terminal as irreversible', () => {
    const answered = question('approved', 10);
    // Equal timestamps use the normal fetch/version rules, not a status lock.
    expect(reconcileIntervention(answered, question('pending', 10))).toBeUndefined();
    const rollback = question('pending', 11);
    expect(reconcileIntervention(answered, rollback)).toBe(rollback);
  });

  it('keeps a different request or sealed batch isolated', () => {
    const pending = question('pending');
    const answered = question('approved');
    expect(reconcileIntervention(pending, { ...answered, tool_call_id: 'call-2' })).toBeUndefined();
    expect(
      reconcileIntervention(pending, {
        ...answered,
        pluginIntervention: { batchId: 'new-batch', status: 'approved' },
      }),
    ).toBeUndefined();
  });

  it('supports legacy plugin intervention rows and ignores optimistic rows', () => {
    const legacy = {
      ...question('pending'),
      pluginIntervention: undefined,
      plugin: {
        apiName: 'askUserQuestion',
        arguments: '{}',
        identifier: 'lobe-agent',
        type: 'builtin' as const,
        intervention: { status: 'pending' as const },
      },
    };
    expect(hasPendingInterventions([legacy])).toBe(true);
    expect(hasPendingInterventions([{ ...legacy, id: 'tmp_question' }])).toBe(false);
    expect(hasPendingInterventions([])).toBe(false);
  });
});
