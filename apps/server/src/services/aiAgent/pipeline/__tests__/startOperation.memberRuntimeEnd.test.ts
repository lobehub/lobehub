import { describe, expect, it, vi } from 'vitest';

import { startOperation } from '../startOperation';

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: vi.fn().mockResolvedValue('jwt'),
}));

const sourceExecutor = { capabilities: ['llm_relay@1'], clientId: 'tab-a', providers: ['ollama'] };

const setup = (sourceAccepts: boolean) => {
  const calls: string[] = [];
  const agentRuntimeService = {
    acceptsMemberRuntimeEnd: vi.fn(async () => {
      calls.push('read-source');
      return sourceAccepts;
    }),
    createOperation: vi.fn(async () => ({ autoStarted: true, messageId: 'msg-assistant' })),
    getLlmExecutor: vi.fn(async () => {
      calls.push('read-executor');
      return sourceExecutor;
    }),
  };
  const deps = {
    agentRuntimeService,
    messageModel: {},
    retirePendingApprovalOperation: vi.fn(async () => {
      calls.push('retire-source');
    }),
    topicModel: { updateMetadata: vi.fn() },
    userId: 'user-1',
    withholdGatewayToken: true,
  } as any;
  const ctx = {
    agentConfig: {},
    assistantMessageId: 'msg-assistant',
    model: 'gpt',
    provider: 'openai',
    resolvedAgentId: 'agt-supervisor',
    topicId: 'tpc-1',
    userMessageId: 'msg-user',
  } as any;
  const input = (extra: Record<string, unknown>) =>
    ({
      approvalClaim: {},
      approvalSourceToolMessageIds: [],
      autoStart: true,
      discovery: {
        credentialFactsPromise: Promise.resolve(undefined),
        modelMediaCapabilities: {},
        toolsResult: { enabledToolIds: [] },
      },
      initialContext: {},
      operationId: 'op-new',
      prep: { allMessages: [], deviceSystemInfo: {} },
      updateAbortedAssistantMessage: vi.fn(),
      userInterventionConfig: { approvalMode: 'manual' },
      ...extra,
    }) as any;
  return { agentRuntimeService, calls, ctx, deps, input };
};

describe('startOperation › member_runtime_end declaration', () => {
  it('records the calling client declaration on the new operation', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup(false);

    await startOperation(deps, ctx, input({ acceptsMemberRuntimeEnd: true }));

    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ acceptsMemberRuntimeEnd: true }),
    );
    expect(agentRuntimeService.acceptsMemberRuntimeEnd).not.toHaveBeenCalled();
  });

  // The v2 approval endpoint starts the continuation server-side, without the
  // client's `streamFeatures`: it is the same client, so the parked op's
  // declaration carries over (read before that op is retired).
  it('carries the parked operation declaration over to an approval continuation', async () => {
    const { agentRuntimeService, calls, ctx, deps, input } = setup(true);

    await startOperation(deps, ctx, input({ approvalSourceOperationId: 'op-parked' }));

    expect(agentRuntimeService.acceptsMemberRuntimeEnd).toHaveBeenCalledWith('op-parked');
    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ acceptsMemberRuntimeEnd: true }),
    );
    expect(calls).toEqual(['read-source', 'read-executor', 'retire-source']);
  });

  // Codex P1 on #20102: an older client resuming an approval of a run a newer
  // client started must get what IT declared (nothing ⇒ false), not the parked
  // operation's `true`.
  it('keeps a resuming client explicit false over the parked operation declaration', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup(true);

    await startOperation(
      deps,
      ctx,
      input({ acceptsMemberRuntimeEnd: false, approvalSourceOperationId: 'op-parked' }),
    );

    expect(agentRuntimeService.acceptsMemberRuntimeEnd).not.toHaveBeenCalled();
    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ acceptsMemberRuntimeEnd: false }),
    );
  });

  it('leaves the declaration unset for a client that did not make one', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup(true);

    await startOperation(deps, ctx, input({}));

    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ acceptsMemberRuntimeEnd: undefined }),
    );
  });
});

describe('startOperation › relay executor', () => {
  it('carries the parked operation relay executor over to an approval continuation', async () => {
    const { agentRuntimeService, calls, ctx, deps, input } = setup(true);

    await startOperation(deps, ctx, input({ approvalSourceOperationId: 'op-parked' }));

    expect(agentRuntimeService.getLlmExecutor).toHaveBeenCalledWith('op-parked');
    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ llmExecutor: sourceExecutor }),
    );
    // Read before the parked operation is retired.
    expect(calls.indexOf('read-executor')).toBeLessThan(calls.indexOf('retire-source'));
  });

  it('keeps the executor the resuming client declared', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup(true);
    const declared = { ...sourceExecutor, clientId: 'tab-b' };

    await startOperation(
      deps,
      ctx,
      input({ approvalSourceOperationId: 'op-parked', llmExecutor: declared }),
    );

    expect(agentRuntimeService.getLlmExecutor).not.toHaveBeenCalled();
    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({ llmExecutor: declared }),
    );
  });
});
