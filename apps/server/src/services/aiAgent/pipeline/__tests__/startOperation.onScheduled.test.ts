import { describe, expect, it, vi } from 'vitest';

import { startOperation } from '../startOperation';

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: vi.fn().mockResolvedValue('jwt'),
}));

const setup = (autoStarted: boolean) => {
  const deps = {
    agentRuntimeService: {
      acceptsFileWorks: vi.fn(async () => false),
      acceptsMemberRuntimeEnd: vi.fn(async () => false),
      createOperation: vi.fn(async () => ({ autoStarted, messageId: 'msg-assistant' })),
      getLlmExecutor: vi.fn(async () => undefined),
      getOperationEditingGroupId: vi.fn(async () => undefined),
    },
    messageModel: { update: vi.fn(async () => undefined) },
    retirePendingApprovalOperation: vi.fn(),
    topicModel: {
      updateMetadata: vi.fn(async () => {
        throw new Error('metadata write failed');
      }),
    },
    userId: 'user-1',
    withholdGatewayToken: true,
  } as any;
  const ctx = {
    agentConfig: {},
    assistantMessageId: 'msg-assistant',
    model: 'gpt',
    provider: 'openai',
    resolvedAgentId: 'agt-1',
    topicId: 'tpc-1',
    userMessageId: 'msg-user',
  } as any;
  const onScheduled = vi.fn();
  const input = {
    approvalClaim: {},
    approvalSourceToolMessageIds: [],
    autoStart: true,
    discovery: {
      credentialFactsPromise: Promise.resolve(undefined),
      modelMediaCapabilities: {},
      toolsResult: { enabledToolIds: [] },
    },
    initialContext: {},
    onScheduled,
    operationId: 'op-new',
    prep: { allMessages: [], deviceSystemInfo: {} },
    updateAbortedAssistantMessage: vi.fn(),
    userInterventionConfig: { approvalMode: 'manual' },
  } as any;
  return { ctx, deps, input, onScheduled };
};

describe('startOperation › onScheduled', () => {
  // A marker write failing after the first step is queued still returns
  // `success: false`, but the run executes; its concurrency slot must follow
  // the run instead of being released by the caller.
  it('reports a queued run even when a later startup write fails', async () => {
    const { ctx, deps, input, onScheduled } = setup(true);

    const result = await startOperation(deps, ctx, input);

    expect(result.success).toBe(false);
    expect(onScheduled).toHaveBeenCalledOnce();
  });

  it('does not report a run created without auto-start', async () => {
    const { ctx, deps, input, onScheduled } = setup(false);

    await startOperation(deps, ctx, input);

    expect(onScheduled).not.toHaveBeenCalled();
  });
});
