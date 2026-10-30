import { describe, expect, it, vi } from 'vitest';

import { startOperation } from '../startOperation';

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: vi.fn().mockResolvedValue('jwt'),
}));

// Codex P1 on #20626: the router-level test mocked `AiAgentService.execAgent`
// as a bare object, so the enrichment in this pipeline stage never ran and the
// assertions there were vacuous. These cases exercise the real inheritance
// implementation: the Group Agent Builder target is read back from the parked
// operation's durable row and merged into the continuation's appContext.
describe('startOperation › group builder editing target inheritance', () => {
  const setup = (durableEditingGroupId?: string) => {
    const calls: string[] = [];
    const agentRuntimeService = {
      acceptsFileWorks: vi.fn(async () => true),
      acceptsMemberRuntimeEnd: vi.fn(async () => true),
      createOperation: vi.fn(async () => ({ autoStarted: true, messageId: 'msg-assistant' })),
      getLlmExecutor: vi.fn(async () => undefined),
      getOperationEditingGroupId: vi.fn(async () => {
        calls.push('read-group-target');
        return durableEditingGroupId;
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

  it('recovers the parked run editing group when the request names none', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup('cg_edited');

    await startOperation(
      deps,
      ctx,
      input({
        approvalSourceOperationId: 'op-parked',
        initialContext: { appContext: { topicId: 'tpc-1' } },
      }),
    );

    expect(agentRuntimeService.getOperationEditingGroupId).toHaveBeenCalledWith('op-parked');
    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({ editingGroupId: 'cg_edited' }),
      }),
    );
    // Read before the parked operation is retired.
  });

  it('lets the parked target win without overwriting a request-named group', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup('cg_edited');
    const groupCtx = {
      ...ctx,
      appContext: { editingGroupId: 'cg_panel', scope: 'group_agent_builder' },
    };

    await startOperation(deps, groupCtx, input({ approvalSourceOperationId: 'op-parked' }));

    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({ editingGroupId: 'cg_panel' }),
      }),
    );
  });

  it('keeps a continuation without a durable group target unchanged (ordinary topic)', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup(undefined);

    await startOperation(
      deps,
      ctx,
      input({
        approvalSourceOperationId: 'op-parked',
        initialContext: { appContext: { topicId: 'tpc-1' } },
      }),
    );

    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.not.objectContaining({ editingGroupId: expect.anything() }),
      }),
    );
  });

  it('does not consult the durable row when there is no approval source', async () => {
    const { agentRuntimeService, ctx, deps, input } = setup('cg_edited');

    await startOperation(deps, ctx, input({}));

    expect(agentRuntimeService.getOperationEditingGroupId).not.toHaveBeenCalled();
    expect(agentRuntimeService.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.not.objectContaining({ editingGroupId: expect.anything() }),
      }),
    );
  });

  it('reads the durable target before retiring the parked operation', async () => {
    const { calls, ctx, deps, input } = setup('cg_edited');

    await startOperation(deps, ctx, input({ approvalSourceOperationId: 'op-parked' }));

    expect(calls.indexOf('read-group-target')).toBeLessThan(calls.indexOf('retire-source'));
  });
});
