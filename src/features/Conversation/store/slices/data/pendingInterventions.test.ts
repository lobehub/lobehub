import { classifyToolInterventionPresentation, type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  canApproveInterventionBatch,
  getInterventionBatch,
  getPendingInterventions,
} from './pendingInterventions';

const toolMessage = (
  id: string,
  toolCallId: string,
  parentId?: string,
  identity?: { batchId?: string; operationId?: string },
): UIChatMessage =>
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
    pluginIntervention: { ...identity, status: 'pending' },
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

  it('separates two durable batches that share the same assistant parent', () => {
    const pending = getPendingInterventions([
      toolMessage('msg-a1', 'call-a1', 'assistant-1', {
        batchId: 'batch-a',
        operationId: 'operation-a',
      }),
      toolMessage('msg-a2', 'call-a2', 'assistant-1', {
        batchId: 'batch-a',
        operationId: 'operation-a',
      }),
      toolMessage('msg-b1', 'call-b1', 'assistant-1', {
        batchId: 'batch-b',
        operationId: 'operation-b',
      }),
    ]);

    expect(getInterventionBatch(pending, pending[0]).map((item) => item.toolCallId)).toEqual([
      'call-a1',
      'call-a2',
    ]);
  });

  it('never mixes a legacy card with a durable sibling under the same parent', () => {
    const pending = getPendingInterventions([
      toolMessage('msg-legacy', 'call-legacy', 'assistant-1'),
      toolMessage('msg-durable', 'call-durable', 'assistant-1', {
        batchId: 'batch-a',
        operationId: 'operation-a',
      }),
    ]);

    expect(getInterventionBatch(pending, pending[0]).map((item) => item.toolCallId)).toEqual([
      'call-legacy',
    ]);
  });

  it('returns nothing when there is no active card', () => {
    expect(getInterventionBatch([], undefined)).toEqual([]);
  });
});

describe('canApproveInterventionBatch', () => {
  const pending = (identifier: string, apiName: string, index: number) =>
    ({
      apiName,
      assistantGroupId: 'assistant-1',
      identifier,
      intervention: { status: 'pending' },
      requestArgs: '{}',
      toolCallId: `call-${index}`,
      toolMessageId: `message-${index}`,
    }) as any;

  it('allows a multi-item batch only when every member is binary', () => {
    expect(
      canApproveInterventionBatch([
        pending('lobe-agent', 'createPlan', 1),
        pending('filesystem', 'writeFile', 2),
      ]),
    ).toBe(true);
  });

  it.each([
    [
      'question',
      [
        pending('lobe-user-interaction', 'askUserQuestion', 1),
        pending('lobe-user-interaction', 'askUserQuestion', 2),
      ],
    ],
    [
      'marketplace',
      [
        pending('lobe-web-onboarding', 'showAgentMarketplace', 1),
        pending('lobe-web-onboarding', 'showAgentMarketplace', 2),
      ],
    ],
    ['heterogeneous', [pending('claude-code', 'permission', 1), pending('qoder', 'plan', 2)]],
    [
      'cursor mixed provider form',
      [pending('filesystem', 'writeFile', 1), pending('cursor', 'requestPermission', 2)],
    ],
    [
      'mixed',
      [
        pending('filesystem', 'writeFile', 1),
        pending('lobe-user-interaction', 'askUserQuestion', 2),
      ],
    ],
  ])('rejects a %s batch', (_name, members) => {
    expect(canApproveInterventionBatch(members as any)).toBe(false);
  });

  it('does not render a bulk action for a single binary card', () => {
    expect(canApproveInterventionBatch([pending('filesystem', 'writeFile', 1)])).toBe(false);
  });

  it('rejects bulk approval when durable identity is partial or mixed', () => {
    const first = pending('filesystem', 'writeFile', 1);
    const second = pending('filesystem', 'writeFile', 2);
    first.operationId = 'operation-a';
    first.batchId = 'batch-a';
    second.operationId = 'operation-b';
    second.batchId = 'batch-b';
    expect(canApproveInterventionBatch([first, second])).toBe(false);

    second.operationId = undefined;
    second.batchId = undefined;
    expect(canApproveInterventionBatch([first, second])).toBe(false);
  });

  it('classifies Cursor AskUser as a question and other ACP approval surfaces as custom forms', () => {
    expect(classifyToolInterventionPresentation('cursor', 'askUserQuestion')).toEqual({
      interactionKind: 'question',
      surface: 'form',
    });
    expect(classifyToolInterventionPresentation('cursor', 'requestPermission')).toEqual({
      interactionKind: 'custom',
      surface: 'form',
    });
  });
});
