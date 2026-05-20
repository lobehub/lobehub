// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfReflectionRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import type { SelfReflectionReviewContext } from '../handler';
import { createServerSelfReflectionPolicyOptions } from '../server';

const mocks = vi.hoisted(() => ({
  initModelRuntimeFromDB: vi.fn(async () => ({ chat: vi.fn() })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));

const payload = {
  agentId: 'agent-1',
  reason: 'tool_failed',
  scopeId: 'topic-1',
  scopeType: 'topic',
  topicId: 'topic-1',
  userId: 'user-1',
  windowEnd: '2026-05-11T01:00:00.000Z',
  windowStart: '2026-05-11T00:00:00.000Z',
} as const;

const source = createSource({
  payload,
  scope: { agentId: 'agent-1', userId: 'user-1' },
  scopeKey: 'topic:topic-1',
  sourceId: 'self-reflection:user-1:agent-1:topic:topic-1',
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
  timestamp: 100,
}) as SourceAgentSelfReflectionRequested;

const context = {
  ...payload,
  evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
  topics: [],
} satisfies SelfReflectionReviewContext;

describe('createServerSelfReflectionPolicyOptions', () => {
  /**
   * @example
   * expect(runtime.tools).toEqual(expect.objectContaining({ writeMemory: expect.any(Function) }));
   */
  it('builds source-scoped self-iteration executor runtime and disables legacy planner execution', async () => {
    const options = createServerSelfReflectionPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    const runtime = await options.runtimeFactory?.createRuntime({ context, payload, source });

    expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledOnce();
    expect(runtime).toEqual(
      expect.objectContaining({
        executeSelfIteration: expect.any(Function),
        model: expect.any(String),
        modelRuntime: expect.objectContaining({ chat: expect.any(Function) }),
        tools: expect.objectContaining({
          getEvidenceDigest: expect.any(Function),
          writeMemory: expect.any(Function),
        }),
      }),
    );
    expect('planReviewOutput' in options).toBe(false);
    expect('executePlan' in options).toBe(false);
  });
});
