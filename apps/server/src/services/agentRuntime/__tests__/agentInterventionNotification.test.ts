// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { deriveAgentInterventionActivityKey } from '@/business/server/agent-run/agentInterventionIdentity';

import { buildRuntimeInterventionNotification } from '../agentInterventionNotification';

vi.mock('@/business/server/agent-run/executeCustomIntervention', () => ({
  getAgentMarketplaceInterventionReview: vi.fn(async () => []),
}));

const binaryTool = {
  apiName: 'editFile',
  arguments: '{"path":"/tmp/a"}',
  id: 'call-1',
  identifier: 'lobe-local-system',
  type: 'builtin' as const,
};

const buildState = (overrides: Record<string, unknown> = {}) => ({
  metadata: {
    agentId: 'agent-1',
    scope: 'main',
    sessionId: 'session-1',
    sourceMessageId: 'user-1',
    taskId: 'task-1',
    topicId: 'topic-1',
  },
  pendingApprovalBatch: {
    assistantMessageId: 'assistant-1',
    id: 'batch-1',
    sealed: true,
    stepIndex: 1,
  },
  pendingToolMessageIds: { 'call-1': 'tool-message-1' },
  pendingToolsCalling: [binaryTool],
  status: 'waiting_for_human',
  toolManifestMap: {
    'lobe-local-system': {
      api: [{ name: 'editFile' }],
      identifier: 'lobe-local-system',
    },
  },
  userInterventionConfig: { approvalMode: 'manual' },
  ...overrides,
});

describe('buildRuntimeInterventionNotification', () => {
  it('builds the fixed identity/revision contract for a safe single binary request', async () => {
    const result = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state: buildState(),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result).toMatchObject({
      approvalMode: 'manual',
      batch: {
        activityKey: '4369e854-719f-5301-bfa4-1f0742eec6ac',
        allowedActions: ['approve_tool', 'reject_continue', 'stop'],
        id: 'batch-1',
        kind: 'single',
        sealed: true,
        stepIndex: 1,
      },
      context: {
        assistantMessageId: 'assistant-1',
        operationId: 'operation-1',
        scope: 'main',
        sessionId: 'session-1',
        taskId: 'task-1',
        topicId: 'topic-1',
        triggerMessageId: 'user-1',
      },
      items: [
        {
          allowedActions: ['approve_tool', 'edit_arguments', 'reject_continue', 'stop'],
          canonicalToolKey: 'lobe-local-system/editFile',
          interactionKind: 'tool_approval',
          requestRevision: {
            hash: '15df809ad5fadb66f0b31bafc206dcfe620d8da8767fb76e41d3603a45dc870d',
            version: 1,
          },
          sourceRef: {
            toolCallId: 'call-1',
            toolMessageId: 'tool-message-1',
            type: 'runtime',
          },
          surface: 'binary',
        },
      ],
      systemActionEligibility: 'safe_single_binary',
    });
    expect(result?.items[0]).not.toHaveProperty('arguments');
    expect(result?.items[0]).not.toHaveProperty('detail');
  });

  it('offers remember only when the authoritative approval mode is allow-list', async () => {
    const result = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state: buildState({ userInterventionConfig: { approvalMode: 'allow-list' } }),
      userId: 'user-1',
    });

    expect(result?.approvalMode).toBe('allow-list');
    expect(result?.items[0].allowedActions).toEqual([
      'approve_tool',
      'approve_tool_remember',
      'edit_arguments',
      'reject_continue',
      'stop',
    ]);
    expect(result?.batch.allowedActions).toEqual(['approve_tool', 'reject_continue', 'stop']);
  });

  it('keeps unknown and incomplete manifest APIs Review-only', async () => {
    const unknown = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state: buildState({ toolManifestMap: {} }),
      userId: 'user-1',
    });
    const missingApi = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state: buildState({
        toolManifestMap: {
          'lobe-local-system': {
            api: [{ name: 'readFile' }],
            identifier: 'lobe-local-system',
          },
        },
      }),
      userId: 'user-1',
    });

    expect(unknown?.systemActionEligibility).toBe('review_only');
    expect(missingApi?.systemActionEligibility).toBe('review_only');
  });

  it('makes custom/mixed batches Review-only and emits explicit AskUser capabilities', async () => {
    const question = {
      apiName: 'askUserQuestion',
      arguments: JSON.stringify({
        questions: [
          {
            id: 'runtime-question',
            options: [{ description: 'Use Postgres', label: 'Postgres', value: 'postgres' }],
            question: 'Which database?',
          },
        ],
        title: 'Choose storage',
      }),
      id: 'call-2',
      identifier: 'lobe-agent',
      type: 'builtin' as const,
    };
    const state = buildState({
      pendingToolMessageIds: {
        'call-1': 'tool-message-1',
        'call-2': 'tool-message-2',
      },
      pendingToolsCalling: [binaryTool, question],
    });

    const result = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state,
      userId: 'user-1',
    });

    expect(result?.batch).toMatchObject({ allowedActions: ['stop'], kind: 'mixed' });
    expect(result?.systemActionEligibility).toBe('review_only');
    expect(result?.items[1]).toMatchObject({
      allowedActions: ['submit_answers', 'skip_interaction', 'stop'],
      detail: {
        answerPolicy: { allowFreeform: true, allowSupplement: true },
        questions: [
          expect.objectContaining({
            allowCustomAnswer: true,
            id: 'runtime-question',
            options: [expect.objectContaining({ id: 'postgres' })],
          }),
        ],
        type: 'question',
      },
      interactionKind: 'question',
      surface: 'form',
    });
  });

  it('matches Web marketplace actions without advertising reserved cancel', async () => {
    const marketplace = {
      apiName: 'showAgentMarketplace',
      arguments: '{"requestId":"request-1","categoryHints":["coding"]}',
      id: 'call-marketplace',
      identifier: 'lobe-web-onboarding',
      type: 'builtin' as const,
    };
    const result = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state: buildState({
        pendingToolMessageIds: { 'call-marketplace': 'tool-marketplace' },
        pendingToolsCalling: [marketplace],
        toolManifestMap: {
          'lobe-web-onboarding': {
            api: [{ name: 'showAgentMarketplace' }],
            identifier: 'lobe-web-onboarding',
          },
        },
      }),
      userId: 'user-1',
    });

    expect(result?.items[0].allowedActions).toEqual(['submit_custom', 'skip_interaction', 'stop']);
    expect(result?.items[0].allowedActions).not.toContain('cancel_interaction');
    expect(result?.systemActionEligibility).toBe('review_only');
  });

  it('emits an exact old-batch supersession for a partially resolved re-park', async () => {
    const result = await buildRuntimeInterventionNotification({
      operationId: 'operation-2',
      state: buildState({
        pendingApprovalBatch: {
          assistantMessageId: 'assistant-1',
          id: 'batch-2',
          sealed: true,
          stepIndex: 1,
          supersedes: {
            batchId: 'batch-1',
            operationId: 'operation-1',
            toolCallIds: ['call-1'],
          },
        },
      }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result?.supersedes).toEqual({
      activityKey: deriveAgentInterventionActivityKey({
        batchId: 'batch-1',
        operationId: 'operation-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
      batchId: 'batch-1',
      operationId: 'operation-1',
      toolCallIds: ['call-1'],
    });
  });

  it('fails closed when supersession does not cover the exact rebound members', async () => {
    await expect(
      buildRuntimeInterventionNotification({
        operationId: 'operation-2',
        state: buildState({
          pendingApprovalBatch: {
            assistantMessageId: 'assistant-1',
            id: 'batch-2',
            sealed: true,
            stepIndex: 1,
            supersedes: {
              batchId: 'batch-1',
              operationId: 'operation-1',
              toolCallIds: ['another-call'],
            },
          },
        }),
        userId: 'user-1',
      }),
    ).rejects.toThrow('Invalid superseded intervention batch identity');
  });

  it('fails closed for incomplete runtime state and normalizes an unknown approval mode', async () => {
    await expect(
      buildRuntimeInterventionNotification({
        operationId: 'operation-1',
        state: buildState({ pendingToolMessageIds: {} }),
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    const result = await buildRuntimeInterventionNotification({
      operationId: 'operation-1',
      state: buildState({ userInterventionConfig: { approvalMode: 'future-mode' } }),
      userId: 'user-1',
    });
    expect(result?.approvalMode).toBe('manual');
  });
});
