import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanUseAgentRunConversation: vi.fn(),
  assertCanUseOperationAgent: vi.fn(),
  assertOperationVisibleToCaller: vi.fn(),
  bridge: vi.fn(),
  execAgent: vi.fn(),
  findToolMessageIdByToolCallId: vi.fn(),
  interruptTask: vi.fn(),
  loadAgentState: vi.fn(),
  mergeMetadata: vi.fn(),
  queueFollowUp: vi.fn(),
  resumeParkedClientTools: vi.fn(),
  startComposerRun: vi.fn(),
  stopPendingApprovalBatch: vi.fn(),
}));

vi.mock('@/server/routers/lambda/_helpers/operationReadGuard', () => ({
  assertOperationVisibleToCaller: mocks.assertOperationVisibleToCaller,
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: vi.fn(),
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation: mocks.assertCanUseAgentRunConversation,
  assertCanUseOperationAgent: mocks.assertCanUseOperationAgent,
}));
vi.mock('@/server/routers/lambda/aiAgent/exec', () => ({
  bridgeLegacyResumeToSourceIntervention: mocks.bridge,
}));
vi.mock('@/server/routers/lambda/aiAgent/intervention', () => ({
  stopPendingApprovalBatch: mocks.stopPendingApprovalBatch,
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = mocks.execAgent;
    interruptTask = mocks.interruptTask;
  },
}));
vi.mock('@/server/services/aiAgent/composerRun', () => ({
  startComposerRun: mocks.startComposerRun,
}));
vi.mock('@/server/services/aiAgent/topicStartReservation', () => ({
  ForeignLiveRunError: class extends Error {},
  TopicStartReservationError: class extends Error {},
}));
vi.mock('@/server/services/aiAgent/steerQueue/followUps', () => ({
  listFollowUps: vi.fn(),
  queueFollowUp: mocks.queueFollowUp,
  removeFollowUp: vi.fn(),
}));
vi.mock('@/server/services/agentRuntime', () => ({ AgentRuntimeService: class {} }));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createAgentStateManager: () => ({ loadAgentState: mocks.loadAgentState }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    mergeMetadata = mocks.mergeMetadata;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findToolMessageIdByToolCallId = mocks.findToolMessageIdByToolCallId;
  },
}));
vi.mock('./client-tool-resume.responses', () => ({
  ClientToolResumeError: class extends Error {
    constructor(
      message: string,
      readonly reason = 'mismatch',
    ) {
      super(message);
    }
  },
  resumeParkedClientTools: mocks.resumeParkedClientTools,
}));

const { RunRestService, toRunStatus } = await import('./run.service');
const { ClientToolResumeError } = await import('./client-tool-resume.responses');

const baseRow = {
  agentId: 'agt-1',
  chatGroupId: null,
  completedAt: null,
  completionReason: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  currency: 'USD',
  error: null,
  id: 'op-1',
  llmCalls: null,
  maxSteps: null,
  metadata: {},
  model: 'gpt-5',
  parentOperationId: null,
  provider: 'openai',
  startedAt: new Date('2026-01-01T00:00:01Z'),
  status: 'running',
  taskId: null,
  threadId: null,
  toolCalls: null,
  topicId: 'tpc-1',
  totalCost: null,
  totalInputTokens: null,
  totalOutputTokens: null,
  totalTokens: null,
  trigger: 'api',
  userId: 'user-1',
  workspaceId: null as string | null,
};

/** A drizzle stand-in: every select chain resolves to `rows`. */
const fakeDb = (rows: unknown[]) => {
  const chain: any = {
    from: () => chain,
    limit: async () => rows,
    orderBy: () => chain,
    where: () => chain,
  };
  return { select: () => chain } as any;
};

const approvalState = {
  pendingApprovalBatch: { id: 'batch-1' },
  pendingToolMessageIds: { 'call-1': 'tmsg-1' },
  pendingToolsCalling: [
    {
      apiName: 'runCommand',
      arguments: '{"cmd":"ls"}',
      id: 'call-1',
      identifier: 'lobe-local-system',
    },
  ],
  status: 'waiting_for_human',
  usage: {
    llm: { apiCalls: 1, tokens: { input: 10, output: 5, total: 15 } },
    tools: { totalCalls: 0 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertOperationVisibleToCaller.mockResolvedValue(undefined);
  mocks.loadAgentState.mockResolvedValue(null);
});

describe('RunRestService.requireRun workspace isolation', () => {
  it('returns a personal run in personal scope', async () => {
    const service = new RunRestService(fakeDb([baseRow]), 'user-1');
    await expect(service.requireRun('op-1')).resolves.toMatchObject({ id: 'op-1' });
  });

  it('hides a workspace run from the personal scope, even for its owner', async () => {
    const service = new RunRestService(fakeDb([{ ...baseRow, workspaceId: 'ws-1' }]), 'user-1');
    await expect(service.requireRun('op-1')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('hides a run of another workspace', async () => {
    const service = new RunRestService(
      fakeDb([{ ...baseRow, workspaceId: 'ws-1' }]),
      'user-1',
      'ws-2',
    );
    await expect(service.requireRun('op-1')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it("propagates the visibility guard's refusal for someone else's run", async () => {
    const refusal = Object.assign(new Error('Operation not found'), { name: 'TRPCError' });
    mocks.assertOperationVisibleToCaller.mockRejectedValue(refusal);
    const service = new RunRestService(fakeDb([baseRow]), 'user-2');
    await expect(service.requireRun('op-1')).rejects.toBe(refusal);
  });
});

describe('toRunStatus', () => {
  it.each([
    ['idle', null, 'queued'],
    ['running', null, 'running'],
    ['running', { status: 'waiting_for_human' }, 'waiting_for_human'],
    [
      'running',
      { pendingToolsCalling: [{ identifier: 'lobe-client-fn' }], status: 'waiting_for_async_tool' },
      'waiting_for_tool_results',
    ],
    [
      'running',
      { pendingToolsCalling: [{ identifier: 'lobe-sub-agent' }], status: 'waiting_for_async_tool' },
      'waiting_for_async_tool',
    ],
    ['waiting_for_client', null, 'running'],
    ['done', { status: 'running' }, 'completed'],
    ['error', null, 'failed'],
    ['interrupted', null, 'cancelled'],
    ['abandoned', null, 'abandoned'],
  ])('row %s + state %j → %s', (row, state, expected) => {
    expect(toRunStatus(row, state as any)).toBe(expected);
  });

  it('reports a started run whose state is still idle as running', () => {
    expect(toRunStatus('running', { status: 'idle' } as any, true)).toBe('running');
    expect(toRunStatus('running', { status: 'idle' } as any, false)).toBe('queued');
  });
});

describe('RunRestService.getRun', () => {
  const journal = (types: string[]) => ({
    getStreamHistory: vi.fn(async () => types.map((type) => ({ type }) as any)),
  });

  it('reports running while the first step streams, before the idle state is saved again', async () => {
    mocks.loadAgentState.mockResolvedValue({ status: 'idle' });
    const service = new RunRestService(fakeDb([baseRow]), 'user-1', undefined, {
      journal: journal(['stream_chunk']),
    });

    await expect(service.getRun('op-1')).resolves.toMatchObject({ status: 'running' });
  });

  it('reports queued until a step starts', async () => {
    mocks.loadAgentState.mockResolvedValue({ status: 'idle' });
    const service = new RunRestService(fakeDb([baseRow]), 'user-1', undefined, {
      journal: journal(['agent_runtime_init']),
    });

    await expect(service.getRun('op-1')).resolves.toMatchObject({ status: 'queued' });
  });

  it('reports an idle reservation as queued without reading the journal', async () => {
    mocks.loadAgentState.mockResolvedValue(null);
    const events = journal(['stream_chunk']);
    const service = new RunRestService(
      fakeDb([{ ...baseRow, status: 'idle' }]),
      'user-1',
      undefined,
      {
        journal: events,
      },
    );

    await expect(service.getRun('op-1')).resolves.toMatchObject({ status: 'queued' });
    expect(events.getStreamHistory).not.toHaveBeenCalled();
  });

  it('reports a parked run with its pending interventions and live usage', async () => {
    mocks.loadAgentState.mockResolvedValue(approvalState);
    const service = new RunRestService(fakeDb([baseRow]), 'user-1');

    const run = await service.getRun('op-1');

    expect(run).toMatchObject({
      id: 'op-1',
      pendingInterventionCount: 1,
      result: null,
      status: 'waiting_for_human',
      stepCount: 1,
      usage: { inputTokens: 10, llmCalls: 1, outputTokens: 5, toolCalls: 0, totalTokens: 15 },
    });
  });
});

describe('RunRestService.resolveIntervention', () => {
  const service = () => new RunRestService(fakeDb([baseRow]), 'user-1');

  beforeEach(() => {
    mocks.loadAgentState.mockResolvedValue(approvalState);
    mocks.bridge.mockResolvedValue(undefined);
    mocks.startComposerRun.mockResolvedValue({ operationId: 'op-2' });
  });

  it('resumes an approval as the app does and links the continuation', async () => {
    const result = await service().resolveIntervention('op-1', 'call-1', { action: 'approve' });

    expect(result).toEqual({ continuedByRunId: 'op-2', interventionId: 'call-1' });
    expect(mocks.startComposerRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appContext: { groupId: undefined, threadId: undefined, topicId: 'tpc-1' },
        parentMessageId: 'tmsg-1',
        prompt: '',
        resumeApproval: { decision: 'approved', parentMessageId: 'tmsg-1', toolCallId: 'call-1' },
      }),
    );
    expect(mocks.mergeMetadata).toHaveBeenCalledWith('op-1', { continuedByRunId: 'op-2' });
  });

  it('maps a reject that continues to rejected_continue with its reason', async () => {
    await service().resolveIntervention('op-1', 'call-1', {
      action: 'reject',
      continue: true,
      reason: 'not now',
    });
    expect(mocks.startComposerRun.mock.calls[0][1].resumeApproval).toEqual({
      decision: 'rejected_continue',
      parentMessageId: 'tmsg-1',
      rejectionReason: 'not now',
      toolCallId: 'call-1',
    });
  });

  it('uses the durable intervention row when the deployment has one', async () => {
    mocks.bridge.mockResolvedValue({ operationId: 'op-3' });
    const result = await service().resolveIntervention('op-1', 'call-1', { action: 'approve' });
    expect(result.continuedByRunId).toBe('op-3');
    expect(mocks.startComposerRun).not.toHaveBeenCalled();
  });

  it('refuses an answer to an approval', async () => {
    await expect(
      service().resolveIntervention('op-1', 'call-1', { action: 'answer', content: 'yes' }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('answers a question with the tool result', async () => {
    mocks.loadAgentState.mockResolvedValue({
      ...approvalState,
      pendingToolsCalling: [
        {
          apiName: 'askUserQuestion',
          arguments: '{}',
          id: 'call-1',
          identifier: 'lobe-user-interaction',
        },
      ],
    });
    await service().resolveIntervention('op-1', 'call-1', {
      action: 'answer',
      answers: { q1: 'Tokyo' },
      content: 'Tokyo',
    });
    expect(mocks.startComposerRun.mock.calls[0][1].resumeToolResult).toEqual({
      content: 'Tokyo',
      outcome: 'submitted',
      parentMessageId: 'tmsg-1',
      pluginState: { askUserAnswers: { q1: 'Tokyo' } },
      toolCallId: 'call-1',
    });
  });

  it('answers 404 for an intervention the run does not wait on', async () => {
    await expect(
      service().resolveIntervention('op-1', 'call-x', { action: 'approve' }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('RunRestService.cancelRun', () => {
  it('settles a run parked on approvals instead of flagging an interrupt', async () => {
    mocks.loadAgentState.mockResolvedValue(approvalState);
    const result = await new RunRestService(fakeDb([baseRow]), 'user-1').cancelRun('op-1');

    expect(result).toEqual({ cancelled: true, id: 'op-1', status: 'cancelled' });
    expect(mocks.stopPendingApprovalBatch).toHaveBeenCalledWith(expect.anything(), {
      batchId: 'batch-1',
      operationId: 'op-1',
      toolMessageIds: ['tmsg-1'],
      topicId: 'tpc-1',
    });
    expect(mocks.interruptTask).not.toHaveBeenCalled();
  });

  it('interrupts a running run', async () => {
    mocks.interruptTask.mockResolvedValue({ success: true });
    await new RunRestService(fakeDb([baseRow]), 'user-1').cancelRun('op-1');
    expect(mocks.interruptTask).toHaveBeenCalledWith({ operationId: 'op-1', topicId: 'tpc-1' });
  });

  it('leaves a finished run alone', async () => {
    const result = await new RunRestService(
      fakeDb([{ ...baseRow, status: 'done' }]),
      'user-1',
    ).cancelRun('op-1');
    expect(result).toEqual({ cancelled: false, id: 'op-1', status: 'completed' });
    expect(mocks.interruptTask).not.toHaveBeenCalled();
  });
});

describe('RunRestService.submitToolResults', () => {
  const body = { results: [{ callId: 'call-1', output: '42' }] };

  it.each([
    ['already_submitted', 'ConflictError'],
    ['mismatch', 'ValidationError'],
  ] as const)('answers a %s resume error as %s, not a 500', async (reason, name) => {
    mocks.resumeParkedClientTools.mockRejectedValue(new ClientToolResumeError('nope', reason));
    await expect(
      new RunRestService(fakeDb([baseRow]), 'user-1').submitToolResults('op-1', body),
    ).rejects.toMatchObject({ name });
  });

  it('resumes only this run, in the background', async () => {
    mocks.resumeParkedClientTools.mockResolvedValue({ callIds: ['call-1'], operationId: 'op-1' });
    const result = await new RunRestService(fakeDb([baseRow]), 'user-1').submitToolResults(
      'op-1',
      body,
    );
    expect(result).toEqual({ callIds: ['call-1'], id: 'op-1', state: 'resumed' });
    expect(mocks.resumeParkedClientTools).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-1', resumeInBackground: true, topicId: 'tpc-1' }),
    );
  });
});

describe('RunRestService.queueMessage', () => {
  it('queues only behind this run', async () => {
    mocks.queueFollowUp.mockResolvedValue({ id: 'm1', length: 1, queued: true, state: 'queued' });
    await new RunRestService(fakeDb([baseRow]), 'user-1').queueMessage('op-1', { content: 'more' });
    expect(mocks.queueFollowUp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        behindOperationId: 'op-1',
        scope: { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      }),
    );
  });

  it('answers 409 when the run is no longer the one taking messages', async () => {
    mocks.queueFollowUp.mockResolvedValue({ queued: false, reason: 'idle' });
    await expect(
      new RunRestService(fakeDb([baseRow]), 'user-1').queueMessage('op-1', { content: 'more' }),
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });
});
