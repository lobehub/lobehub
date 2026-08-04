import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getInterventionBatch, getPendingInterventions } from './pendingInterventions';

const toolMessage = (id: string, toolCallId: string, parentId?: string): UIChatMessage =>
  ({
    id,
    parentId,
    plugin: {
      apiName: 'createPlan',
      arguments: '{}',
      id: toolCallId,
      identifier: 'lobe-agent',
      type: 'builtin',
    },
    pluginIntervention: { status: 'pending' },
    role: 'tool',
    tool_call_id: toolCallId,
  }) as any;

const assistantGroup = (id: string, toolCallIds: string[]): UIChatMessage =>
  ({
    children: [
      {
        tools: toolCallIds.map((toolCallId) => ({
          apiName: 'createPlan',
          arguments: '{}',
          id: toolCallId,
          identifier: 'lobe-agent',
          intervention: { status: 'pending' },
          result_msg_id: `msg-${toolCallId}`,
          type: 'builtin',
        })),
      },
    ],
    id,
    role: 'assistantGroup',
  }) as any;

describe('getPendingInterventions', () => {
  it('records the owning assistant for a standalone tool row', () => {
    const [pending] = getPendingInterventions([toolMessage('msg-1', 'call-1', 'assistant-1')]);

    // Without an owner, a bulk action cannot tell this call apart from one that
    // belongs to a different turn.
    expect(pending.assistantGroupId).toBe('assistant-1');
  });

  it('records the owning assistant for a folded assistantGroup', () => {
    const pending = getPendingInterventions([assistantGroup('assistant-1', ['call-1', 'call-2'])]);

    expect(pending.map((p) => p.assistantGroupId)).toEqual(['assistant-1', 'assistant-1']);
  });

  it('spans the whole conversation, including an abandoned approval from an earlier turn', () => {
    const pending = getPendingInterventions([
      toolMessage('msg-stale', 'call-stale', 'assistant-old'),
      assistantGroup('assistant-new', ['call-1', 'call-2']),
    ]);

    // This is exactly why length alone must never gate a bulk approval.
    expect(pending).toHaveLength(3);
  });
});

describe('getInterventionBatch', () => {
  it('keeps only the calls emitted by the active card’s own assistant turn', () => {
    const pending = getPendingInterventions([
      toolMessage('msg-stale', 'call-stale', 'assistant-old'),
      assistantGroup('assistant-new', ['call-1', 'call-2']),
    ]);
    const active = pending.find((p) => p.toolCallId === 'call-1')!;

    const batch = getInterventionBatch(pending, active);

    // Approving across turns would resolve `call-stale` under this turn's
    // assistant anchor and continue the model once with unrelated results.
    expect(batch.map((b) => b.toolCallId)).toEqual(['call-1', 'call-2']);
  });

  it('treats an entry with no resolvable owner as its own batch', () => {
    const pending = getPendingInterventions([
      toolMessage('msg-1', 'call-1'),
      toolMessage('msg-2', 'call-2'),
    ]);
    const active = pending.find((p) => p.toolCallId === 'call-1')!;

    // Both have `assistantGroupId === undefined`; grouping by that value would
    // fold two unrelated calls into one pseudo-batch.
    expect(getInterventionBatch(pending, active).map((b) => b.toolCallId)).toEqual(['call-1']);
  });

  it('returns nothing when there is no active card', () => {
    expect(getInterventionBatch([], undefined)).toEqual([]);
  });
});
