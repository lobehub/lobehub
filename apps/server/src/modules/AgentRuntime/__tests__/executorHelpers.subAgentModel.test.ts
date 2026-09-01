import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type RuntimeExecutorContext } from '../context';
import { buildServerAgentMemberRunner, buildServerVirtualSubAgentRunner } from '../executorHelpers';

/**
 * The parent model a spawned `callSubAgent` follows must be the model the
 * parent run ACTUALLY uses. `metadata.agentConfig` alone is not enough: when a
 * run continues a topic whose model was switched, execAgent keeps the
 * topic-pinned model only in `modelRuntimeConfig` while the metadata config
 * retains the agent default.
 */
describe('buildServerVirtualSubAgentRunner sub-agent model resolution', () => {
  const buildRunner = (state: Partial<AgentState>) => {
    const execVirtualSubAgent = vi.fn().mockResolvedValue({ operationId: 'child-op' });
    const ctx = {
      execVirtualSubAgent,
      messageModel: { create: vi.fn().mockResolvedValue({ id: 'placeholder-id' }) },
      operationId: 'parent-op',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;

    const runner = buildServerVirtualSubAgentRunner(
      ctx,
      {
        metadata: { agentId: 'agent-1', topicId: 'topic-1' },
        operationId: 'parent-op',
        ...state,
      } as AgentState,
      { id: 'tool-call-1' } as ChatToolPayload,
      'parent-message-1',
    );

    return { execVirtualSubAgent, runner };
  };

  it('follows the topic-pinned runtime model over the metadata agent default', async () => {
    const { execVirtualSubAgent, runner } = buildRunner({
      metadata: {
        agentConfig: { model: 'agent-default-model', provider: 'agent-default-provider' },
        agentId: 'agent-1',
        topicId: 'topic-1',
      },
      modelRuntimeConfig: { model: 'topic-pinned-model', provider: 'topic-pinned-provider' },
    });

    await runner!.run({ description: 'task', instruction: 'do it' });

    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'topic-pinned-model', provider: 'topic-pinned-provider' }),
    );
  });

  it('falls back to the metadata agent config when no runtime model exists', async () => {
    const { execVirtualSubAgent, runner } = buildRunner({
      metadata: {
        agentConfig: { model: 'agent-default-model', provider: 'agent-default-provider' },
        agentId: 'agent-1',
        topicId: 'topic-1',
      },
    });

    await runner!.run({ description: 'task', instruction: 'do it' });

    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'agent-default-model', provider: 'agent-default-provider' }),
    );
  });

  it('keeps a named callAgent target on its own model', async () => {
    const { execVirtualSubAgent, runner } = buildRunner({
      modelRuntimeConfig: { model: 'topic-pinned-model', provider: 'topic-pinned-provider' },
    });

    await runner!.run({ agentId: 'target-agent', description: 'task', instruction: 'do it' });

    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'target-agent', model: undefined, provider: undefined }),
    );
  });
});

// Fail-close regression for share-visitor runs: the child run spawned by
// either runner does not inherit the parent's shareGate, so for a run with
// `ctx.agentShareVisitor` set, no runner may be built at all.
describe('runner builders fail closed for share-visitor runs', () => {
  const shareCtx = {
    agentShareVisitor: {
      agentId: 'agent-1',
      shareId: 'share-1',
      visitorUserId: 'visitor-1',
    },
    execGroupMember: vi.fn(),
    execVirtualSubAgent: vi.fn(),
    messageModel: { create: vi.fn() },
    operationId: 'parent-op',
    topicId: 'topic-1',
  } as unknown as RuntimeExecutorContext;

  const state = {
    metadata: { agentId: 'agent-1', groupId: 'group-1', topicId: 'topic-1' },
    operationId: 'parent-op',
  } as unknown as AgentState;

  it('buildServerVirtualSubAgentRunner returns undefined when agentShareVisitor is set', () => {
    expect(
      buildServerVirtualSubAgentRunner(
        shareCtx,
        state,
        { id: 'tool-call-1' } as ChatToolPayload,
        'parent-message-1',
      ),
    ).toBeUndefined();
  });

  it('buildServerAgentMemberRunner returns undefined when agentShareVisitor is set', () => {
    expect(
      buildServerAgentMemberRunner(
        shareCtx,
        state,
        { id: 'tool-call-1' } as ChatToolPayload,
        'parent-message-1',
      ),
    ).toBeUndefined();
  });
});
