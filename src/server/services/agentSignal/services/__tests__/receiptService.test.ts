// @vitest-environment node
import type { BaseAction, ExecutorResult } from '@lobechat/agent-signal';
import { createSource } from '@lobechat/agent-signal';
import { describe, expect, it, vi } from 'vitest';

import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../policies/types';
import type { AgentSignalReceiptStore } from '../receiptService';
import { persistAgentSignalReceipts, projectAgentSignalReceipts } from '../receiptService';

const source = createSource({
  payload: {
    agentId: 'agent-1',
    assistantMessageId: 'assistant-1',
    operationId: 'op-1',
    topicId: 'topic-1',
  },
  scope: { topicId: 'topic-1', userId: 'user-1' },
  scopeKey: 'topic:topic-1',
  sourceId: 'source-1',
  sourceType: 'client.gateway.runtime_end',
  timestamp: 1_700_000,
});

const action = (input: {
  actionId: string;
  actionType: string;
  payload: Record<string, unknown>;
}): BaseAction => ({
  actionId: input.actionId,
  actionType: input.actionType,
  chain: { rootSourceId: 'source-1' },
  payload: input.payload,
  signal: { signalId: 'signal-1', signalType: 'signal.feedback.domain.memory' },
  source: { sourceId: 'source-1', sourceType: 'client.gateway.runtime_end' },
  timestamp: 1_700_000,
});

const result = (input: {
  actionId: string;
  output?: Record<string, unknown>;
  status: 'applied' | 'skipped';
}): ExecutorResult => ({
  actionId: input.actionId,
  attempt: {
    completedAt: 1_700_001,
    current: 1,
    startedAt: 1_700_000,
    status: input.status === 'applied' ? 'succeeded' : input.status,
  },
  ...(input.output ? { output: input.output } : {}),
  status: input.status,
});

describe('projectAgentSignalReceipts', () => {
  it('projects applied memory action results', () => {
    expect(
      projectAgentSignalReceipts({
        actions: [
          action({
            actionId: 'action-memory-1',
            actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle,
            payload: { message: 'Remember that future PR reviews should be decision-first.' },
          }),
        ],
        results: [result({ actionId: 'action-memory-1', status: 'applied' })],
        source,
        userId: 'user-1',
      }),
    ).toEqual([
      {
        agentId: 'agent-1',
        anchorMessageId: 'assistant-1',
        createdAt: 1_700_000,
        detail: 'Saved this for future replies',
        id: 'source-1:action-memory-1:memory',
        kind: 'memory',
        operationId: 'op-1',
        sourceId: 'source-1',
        sourceType: 'client.gateway.runtime_end',
        status: 'applied',
        target: {
          title: 'Remember that future PR reviews should be decision-first.',
          type: 'memory',
        },
        title: 'Memory saved',
        topicId: 'topic-1',
        userId: 'user-1',
      },
    ]);
  });

  it('projects applied skill-management results as updated skill receipts', () => {
    expect(
      projectAgentSignalReceipts({
        actions: [
          action({
            actionId: 'action-skill-1',
            actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
            payload: {},
          }),
        ],
        results: [result({ actionId: 'action-skill-1', status: 'applied' })],
        source,
        userId: 'user-1',
      }),
    ).toMatchObject([{ kind: 'skill', status: 'updated', title: 'Skill updated' }]);
  });

  it('projects skill target snapshots from action results', () => {
    expect(
      projectAgentSignalReceipts({
        actions: [
          action({
            actionId: 'action-skill-1',
            actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
            payload: {},
          }),
        ],
        results: [
          result({
            actionId: 'action-skill-1',
            output: {
              target: {
                agentDocumentId: 'index-agent-document-1',
                documentId: 'index-document-1',
                id: 'document-1',
                summary: 'Review metadata before diff and produce a merge decision.',
                title: 'GitHub PR review workflow',
                type: 'skill',
              },
            },
            status: 'applied',
          }),
        ],
        source,
        userId: 'user-1',
      }),
    ).toMatchObject([
      {
        kind: 'skill',
        target: {
          agentDocumentId: 'index-agent-document-1',
          documentId: 'index-document-1',
          id: 'document-1',
          summary: 'Review metadata before diff and produce a merge decision.',
          title: 'GitHub PR review workflow',
          type: 'skill',
        },
      },
    ]);
  });

  it('does not project skipped, failed, procedure, or missing-topic results', () => {
    expect(
      projectAgentSignalReceipts({
        actions: [
          action({
            actionId: 'action-memory-1',
            actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle,
            payload: {},
          }),
          action({
            actionId: 'action-other-1',
            actionType: 'action.procedure.handle',
            payload: {},
          }),
        ],
        results: [
          result({ actionId: 'action-memory-1', status: 'skipped' }),
          result({ actionId: 'action-other-1', status: 'applied' }),
        ],
        source,
        userId: 'user-1',
      }),
    ).toEqual([]);
  });
});

describe('persistAgentSignalReceipts', () => {
  it('persists all receipts with the configured TTL', async () => {
    const store: AgentSignalReceiptStore = {
      appendReceipt: vi.fn().mockResolvedValue(true),
      listReceipts: vi.fn(),
    };
    const receipt = {
      agentId: 'agent-1',
      createdAt: 1,
      detail: 'Saved this for future replies',
      id: 'receipt-1',
      kind: 'memory' as const,
      sourceId: 'source-1',
      sourceType: 'client.gateway.runtime_end',
      status: 'applied' as const,
      title: 'Memory saved',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await persistAgentSignalReceipts([receipt], { store });

    expect(store.appendReceipt).toHaveBeenCalledWith(receipt, 259_200);
  });

  it('does not reject when receipt persistence fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store: AgentSignalReceiptStore = {
      appendReceipt: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      listReceipts: vi.fn(),
    };
    const receipt = {
      agentId: 'agent-1',
      createdAt: 1,
      detail: 'Saved this for future replies',
      id: 'receipt-1',
      kind: 'memory' as const,
      sourceId: 'source-1',
      sourceType: 'client.gateway.runtime_end',
      status: 'applied' as const,
      title: 'Memory saved',
      topicId: 'topic-1',
      userId: 'user-1',
    };

    await expect(persistAgentSignalReceipts([receipt], { store })).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[AgentSignal] Failed to persist receipt:',
      expect.objectContaining({
        id: 'receipt-1',
        kind: 'memory',
        sourceId: 'source-1',
        topicId: 'topic-1',
      }),
    );
    consoleError.mockRestore();
  });
});
