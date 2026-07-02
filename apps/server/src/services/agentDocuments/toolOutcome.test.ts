import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { emitAgentDocumentToolOutcomeSafely as EmitAgentDocumentToolOutcomeSafely } from './toolOutcome';

const procedureMocks = vi.hoisted(() => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(() => ({
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'agent:agent-1:user:user-1',
  })),
}));

const policyStateStoreMocks = vi.hoisted(() => ({
  redisPolicyStateStore: { sentinel: 'redis-policy-store' },
}));

vi.mock('@/server/services/agentSignal/procedure', () => procedureMocks);
vi.mock(
  '@/server/services/agentSignal/store/adapters/redis/policyStateStore',
  () => policyStateStoreMocks,
);

let emitAgentDocumentToolOutcomeSafely: typeof EmitAgentDocumentToolOutcomeSafely;

beforeAll(async () => {
  ({ emitAgentDocumentToolOutcomeSafely } = await import('./toolOutcome'));
});

describe('emitAgentDocumentToolOutcomeSafely', () => {
  beforeEach(() => {
    procedureMocks.emitToolOutcomeSafely.mockClear();
    procedureMocks.resolveToolOutcomeScope.mockClear();
  });

  it('maps hinted document creation to a skill document outcome', async () => {
    await emitAgentDocumentToolOutcomeSafely({
      agentDocumentId: 'agent-doc-1',
      agentId: 'agent-1',
      apiName: 'createDocument',
      hintIsSkill: true,
      messageId: 'message-1',
      operationId: 'operation-1',
      relation: 'created',
      status: 'succeeded',
      summary: 'Agent documents created a document.',
      taskId: 'task-1',
      toolAction: 'create',
      toolCallId: 'tool-call-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(procedureMocks.resolveToolOutcomeScope).toHaveBeenCalledWith({
      agentId: 'agent-1',
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(procedureMocks.emitToolOutcomeSafely).toHaveBeenCalledWith({
      apiName: 'createDocument',
      context: { agentId: 'agent-1', userId: 'user-1' },
      domainKey: 'document:agent-document',
      errorReason: undefined,
      identifier: AgentDocumentsIdentifier,
      intentClass: 'hinted_skill_document',
      messageId: 'message-1',
      operationId: 'operation-1',
      policyStateStore: policyStateStoreMocks.redisPolicyStateStore,
      relatedObjects: [
        {
          objectId: 'agent-doc-1',
          objectType: 'agent-document',
          relation: 'created',
        },
      ],
      scope: { agentId: 'agent-1', userId: 'user-1' },
      scopeKey: 'agent:agent-1:user:user-1',
      status: 'succeeded',
      summary: 'Agent documents created a document.',
      ttlSeconds: 7 * 24 * 60 * 60,
      toolAction: 'create',
      toolCallId: 'tool-call-1',
    });
  });

  it('maps non-hinted documents to explicit persistence outcomes', async () => {
    await emitAgentDocumentToolOutcomeSafely({
      agentId: 'agent-1',
      apiName: 'createDocument',
      status: 'succeeded',
      summary: 'Agent documents created a document.',
      taskId: null,
      toolAction: 'create',
      userId: 'user-1',
    });

    expect(procedureMocks.resolveToolOutcomeScope).toHaveBeenCalledWith({
      agentId: 'agent-1',
      taskId: undefined,
      topicId: undefined,
      userId: 'user-1',
    });
    expect(procedureMocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        intentClass: 'explicit_persistence',
        relatedObjects: undefined,
      }),
    );
  });

  it('passes failed outcome status and error reason', async () => {
    await emitAgentDocumentToolOutcomeSafely({
      agentId: 'agent-1',
      apiName: 'replaceDocumentContent',
      errorReason: 'write failed',
      status: 'failed',
      summary: 'Agent documents replaced document content failed.',
      toolAction: 'replace',
      userId: 'user-1',
    });

    expect(procedureMocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        errorReason: 'write failed',
        status: 'failed',
      }),
    );
  });
});
