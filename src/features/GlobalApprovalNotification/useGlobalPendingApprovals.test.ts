import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type Operation } from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { collectGlobalApprovals } from './useGlobalPendingApprovals';

// A standalone tool message that `getPendingInterventions` recognizes as pending.
const pendingToolMessage = (id: string, toolCallId: string): UIChatMessage =>
  ({
    id,
    plugin: { apiName: 'runCommand', arguments: '{}', identifier: 'lobe-local-system' },
    pluginIntervention: { status: 'pending' },
    role: 'tool',
    tool_call_id: toolCallId,
  }) as unknown as UIChatMessage;

const op = (
  context: Operation['context'],
  type: Operation['type'] = 'execServerAgentRuntime',
): Operation => ({ context, type }) as unknown as Operation;

// A Claude Code (heterogeneous) intervention: the executor stamps the canonical
// `intervention.status='pending'` onto the parent assistant's `tools[]` (mirrored
// from the tool message), which `getPendingInterventions` reads via the
// children-block path. Identifier is `claude-code`.
const ccAssistantWithPendingTool = (assistantId: string, toolMsgId: string): UIChatMessage =>
  ({
    children: [
      {
        tools: [
          {
            apiName: 'AskUserQuestion',
            arguments: '{}',
            id: 'call_cc_1',
            identifier: 'claude-code',
            intervention: { status: 'pending' },
            result_msg_id: toolMsgId,
          },
        ],
      },
    ],
    id: assistantId,
    role: 'assistant',
  }) as unknown as UIChatMessage;

describe('collectGlobalApprovals', () => {
  it('surfaces a pending bucket whose context is resolvable from an operation', () => {
    const ctx = { agentId: 'agt_a', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);

    const groups = collectGlobalApprovals(
      { [key]: [pendingToolMessage('msg_1', 'call_1')] },
      { op_1: op(ctx) },
      null,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(key);
    expect(groups[0].context).toEqual(ctx);
    expect(groups[0].interventions).toHaveLength(1);
    expect(groups[0].interventions[0].toolMessageId).toBe('msg_1');
  });

  it('excludes the conversation currently on screen (active key)', () => {
    const ctx = { agentId: 'agt_a', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);

    const groups = collectGlobalApprovals(
      { [key]: [pendingToolMessage('msg_1', 'call_1')] },
      { op_1: op(ctx) },
      key, // active
    );

    expect(groups).toHaveLength(0);
  });

  it('skips buckets that resolve to neither an operation nor message fields', () => {
    const ctx = { agentId: 'agt_a', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);

    // Pending message exists, but no operation pins the bucket AND the message
    // carries no coordinates to reconstruct from → cannot mount.
    const groups = collectGlobalApprovals(
      { [key]: [pendingToolMessage('msg_1', 'call_1')] },
      {},
      null,
    );

    expect(groups).toHaveLength(0);
  });

  it('falls back to message fields when the parked run operation is gone', () => {
    // A run parked for approval completes (and later GCs) its operation while
    // the tool stays pending — the bucket must stay visible via the message's
    // own agent/topic coordinates, verified to reproduce the same key.
    const ctx = { agentId: 'agt_a', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);
    const msg = {
      agentId: 'agt_a',
      id: 'msg_1',
      plugin: { apiName: 'runCommand', arguments: '{}', identifier: 'lobe-local-system' },
      pluginIntervention: { status: 'pending' },
      role: 'tool',
      tool_call_id: 'call_1',
      topicId: 'tpc_1',
    } as unknown as UIChatMessage;

    const groups = collectGlobalApprovals({ [key]: [msg] }, {}, null);

    expect(groups).toHaveLength(1);
    expect(groups[0].context).toEqual({ agentId: 'agt_a', threadId: undefined, topicId: 'tpc_1' });
  });

  it('skips buckets without any pending intervention', () => {
    const ctx = { agentId: 'agt_a', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);
    const resolved = {
      id: 'msg_1',
      plugin: { apiName: 'runCommand', arguments: '{}', identifier: 'lobe-local-system' },
      pluginIntervention: { status: 'approved' },
      role: 'tool',
      tool_call_id: 'call_1',
    } as unknown as UIChatMessage;

    const groups = collectGlobalApprovals({ [key]: [resolved] }, { op_1: op(ctx) }, null);

    expect(groups).toHaveLength(0);
  });

  it('resolves thread-scope buckets via the run operation context', () => {
    const ctx = { agentId: 'agt_a', threadId: 'thd_1', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);

    const groups = collectGlobalApprovals(
      { [key]: [pendingToolMessage('msg_1', 'call_1')] },
      { op_1: op(ctx) },
      null,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].context).toEqual(ctx);
  });

  it('surfaces a Claude Code (hetero) wait-for-human in a thread-scope bucket', () => {
    // CC runs in a Thread; the parked intervention lives on the assistant's
    // tools[] and the run keeps a live `execHeterogeneousAgent` operation whose
    // context resolves the thread bucket.
    const ctx = { agentId: 'agt_cc', threadId: 'thd_1', topicId: 'tpc_1' };
    const key = messageMapKey(ctx);

    const groups = collectGlobalApprovals(
      { [key]: [ccAssistantWithPendingTool('asst_cc', 'msg_cc_tool')] },
      { op_cc: op(ctx, 'execHeterogeneousAgent') },
      null,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].context).toEqual(ctx);
    expect(groups[0].interventions[0].identifier).toBe('claude-code');
    expect(groups[0].interventions[0].toolMessageId).toBe('msg_cc_tool');
  });
});
