// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '@/server/services/aiAgent';

import { runStep, runStepHealth } from '../runStep';

const mockGetOperationMetadata = vi.fn();
const mockLoadInlineResume = vi.fn();
const mockClearInlineResume = vi.fn();
const mockExecuteStep = vi.fn();
const mockScheduleContinuation = vi.fn();
const mockReleaseOperationLock = vi.fn();
const mockGetServerDB = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return {
      clearInlineResume: mockClearInlineResume,
      getOperationMetadata: mockGetOperationMetadata,
      loadInlineResume: mockLoadInlineResume,
    };
  }),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      createOperationLockOwner: (operationId: string) => `${operationId}:owner`,
      executeStep: mockExecuteStep,
      releaseOperationLock: mockReleaseOperationLock,
      scheduleContinuation: mockScheduleContinuation,
    };
  }),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

const mockInlineStepsEnabled = vi.fn();
vi.mock('@/server/services/agentRuntime/inlineStepsGate', () => ({
  isInlineAgentStepsEnabledForUser: (userId: string) => mockInlineStepsEnabled(userId),
}));

function buildOperationDiagnosticDB(row?: any) {
  return {
    select: vi.fn(function () {
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(row ? [row] : []),
          })),
        })),
      };
    }),
  };
}

function buildContext(opts: {
  body?: unknown;
  jsonThrows?: boolean;
  messageId?: string;
  retried?: string;
}) {
  const captures: Array<{ body: any; status: number; headers?: Record<string, string> }> = [];
  const ctx = {
    json: (b: any, status = 200, headers?: Record<string, string>) => {
      captures.push({ body: b, status, headers });
      return Response.json(b, { status, headers });
    },
    req: {
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'upstash-retried') return opts.retried;
        if (normalized === 'upstash-message-id') return opts.messageId;
        return undefined;
      },
      json: opts.jsonThrows
        ? async () => {
            throw new Error('bad json');
          }
        : async () => opts.body,
    },
  } as any;
  return { ctx, getCaptures: () => captures };
}

const validBody = {
  context: { foo: 'bar' },
  operationId: 'op-1',
  stepIndex: 2,
};

describe('runStep handler', () => {
  beforeEach(() => {
    mockGetOperationMetadata.mockReset();
    mockInlineStepsEnabled.mockReset();
    mockInlineStepsEnabled.mockResolvedValue(true);
    mockLoadInlineResume.mockReset();
    mockLoadInlineResume.mockResolvedValue(null);
    mockClearInlineResume.mockReset();
    mockExecuteStep.mockReset();
    mockScheduleContinuation.mockReset();
    mockReleaseOperationLock.mockReset();
    mockGetServerDB.mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when JSON parsing throws', async () => {
    const { ctx, getCaptures } = buildContext({ jsonThrows: true });
    const res = await runStep(ctx);
    expect(res.status).toBe(400);
    expect(getCaptures()[0].body).toEqual({ error: 'Invalid JSON body' });
    expect(mockGetOperationMetadata).not.toHaveBeenCalled();
  });

  it('returns 400 when operationId is missing', async () => {
    const { ctx } = buildContext({ body: { stepIndex: 0 } });
    const res = await runStep(ctx);
    expect(res.status).toBe(400);
    expect(mockGetOperationMetadata).not.toHaveBeenCalled();
  });

  it('returns 401 when operation metadata has no userId', async () => {
    mockGetOperationMetadata.mockResolvedValue(null);
    mockGetServerDB.mockResolvedValue(
      buildOperationDiagnosticDB({
        completedAt: null,
        startedAt: new Date('2026-07-07T03:23:44.015Z'),
        status: 'running',
        stepCount: null,
        traceS3Key: null,
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const { ctx, getCaptures } = buildContext({ body: validBody });

    const res = await runStep(ctx);

    expect(res.status).toBe(401);
    expect(getCaptures()[0].body).toEqual({ error: 'Invalid operation or unauthorized' });
    expect(mockExecuteStep).not.toHaveBeenCalled();
    expect(JSON.parse(warnSpy.mock.calls[0][0])).toMatchObject({
      dbRow: {
        exists: true,
        startedAt: '2026-07-07T03:23:44.015Z',
        status: 'running',
        stepCount: null,
        traceS3KeyPresent: false,
      },
      event: 'agent.run_step.missing_operation_metadata',
      metadataPresent: false,
      operationId: 'op-1',
      stepIndex: 2,
      upstashRetried: null,
    });
    warnSpy.mockRestore();
  });

  it('includes QStash retry and message IDs in missing metadata diagnostics', async () => {
    mockGetOperationMetadata.mockResolvedValue({});
    mockGetServerDB.mockResolvedValue(buildOperationDiagnosticDB());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const { ctx } = buildContext({
      body: validBody,
      messageId: 'msg-123',
      retried: '3',
    });

    await runStep(ctx);

    expect(JSON.parse(warnSpy.mock.calls[0][0])).toMatchObject({
      dbRow: {
        exists: false,
        status: null,
      },
      metadataHasUserId: false,
      metadataPresent: true,
      operationId: 'op-1',
      qstashMessageId: 'msg-123',
      stepIndex: 2,
      upstashRetried: '3',
    });
    warnSpy.mockRestore();
  });

  it('steps through AiAgentService scoped to the operation workspace', async () => {
    // Regression (two invariants in one path):
    // 1. workspaceId — a workspace-scoped binding (e.g. Discord bot active agent)
    //    runs its steps through this QStash worker. Dropping it makes the runtime
    //    personal-scoped, so the parent-message lookup misses the workspace-scoped
    //    row → ConversationParentMissing.
    // 2. sub-agent forking — stepping MUST go through AiAgentService (not a bare
    //    AgentRuntimeService), because only AiAgentService's runtime carries the
    //    in-process `execSubAgent` fork callback. A bare runtime here makes
    //    `lobe-agent.callSubAgent` fail with SUB_AGENT_UNAVAILABLE.
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1', workspaceId: 'ws-1' });
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: { cost: { total: 0 }, status: 'done', stepCount: 1 },
      success: true,
    });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(AiAgentService).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.objectContaining({ includeShareVisitor: false, workspaceId: 'ws-1' }),
    );
    expect(mockExecuteStep).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-1', stepIndex: 2 }),
    );
  });

  it('opts the AiAgentService into visitor rows when metadata carries streamOwnerUserId', async () => {
    // A shared-agent visitor run: the op executes as the creator `userId`
    // (`user-owner`) but the visitor (`visitor-1`) owns the stream. The step
    // worker must set `includeShareVisitor: true` so the runtime's
    // MessageModel / TopicModel can still read the visitor-scoped rows that
    // `MessageModel` / `TopicModel` gate out by default.
    mockGetOperationMetadata.mockResolvedValue({
      streamOwnerUserId: 'visitor-1',
      userId: 'user-owner',
      workspaceId: 'ws-1',
    });
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: { cost: { total: 0 }, status: 'done', stepCount: 1 },
      success: true,
    });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(AiAgentService).toHaveBeenCalledWith(
      expect.anything(),
      'user-owner',
      expect.objectContaining({ includeShareVisitor: true, workspaceId: 'ws-1' }),
    );
  });

  it('acks without retry when the runtime already re-queued the locked step', async () => {
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1' });
    mockExecuteStep.mockResolvedValue({
      locked: true,
      lockRescheduled: true,
      nextStepScheduled: true,
      state: {},
      success: true,
    });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    // Must not be retryable: a re-delivery is already scheduled, and letting
    // QStash retry on top of it is what dead-letters the step.
    expect(res.status).toBe(200);
    expect(getCaptures()[0].body).toMatchObject({
      locked: true,
      nextStepScheduled: true,
      operationId: 'op-1',
      stepIndex: 2,
      success: true,
    });
  });

  it('returns 429 with Retry-After header when the step is locked', async () => {
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1' });
    mockExecuteStep.mockResolvedValue({
      locked: true,
      nextStepScheduled: false,
      state: {},
      success: false,
    });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(429);
    const captured = getCaptures()[0];
    expect(captured.body).toMatchObject({
      error: 'Step is currently being executed, retry later',
      operationId: 'op-1',
      stepIndex: 2,
    });
    expect(captured.headers).toEqual({ 'Retry-After': '37' });
  });

  it('forwards the upstash-retried header to executeStep as externalRetryCount', async () => {
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1' });
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: { status: 'done', cost: { total: 0 }, stepCount: 1 },
      success: true,
    });

    const { ctx } = buildContext({ body: validBody, retried: '3' });
    await runStep(ctx);

    expect(mockExecuteStep).toHaveBeenCalledWith(
      expect.objectContaining({ externalRetryCount: 3, operationId: 'op-1', stepIndex: 2 }),
    );
  });

  it('unwraps QStash `body.payload` resume/intervention fields into executeStep', async () => {
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1' });
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: { cost: { total: 0 }, status: 'running', stepCount: 2 },
      success: true,
    });

    // QStash nests these under `body.payload`, not the top level.
    const { ctx } = buildContext({
      body: {
        context: { foo: 'bar' },
        operationId: 'op-1',
        payload: {
          approvedToolCall: { id: 'tc1' },
          resumeAsyncTool: true,
          toolMessageId: 'msg-1',
        },
        stepIndex: 2,
      },
    });
    await runStep(ctx);

    expect(mockExecuteStep).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedToolCall: { id: 'tc1' },
        operationId: 'op-1',
        resumeAsyncTool: true,
        stepIndex: 2,
        toolMessageId: 'msg-1',
      }),
    );
  });

  it('shapes the success response with status, totals and pending fields', async () => {
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1' });
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: true,
      state: {
        cost: { total: 0.42 },
        pendingHumanPrompt: { id: 'p1' },
        pendingHumanSelect: undefined,
        pendingToolsCalling: ['t1'],
        status: 'waiting_for_human',
        stepCount: 5,
      },
      success: true,
    });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(200);
    expect(getCaptures()[0].body).toMatchObject({
      completed: false,
      nextStepIndex: 3,
      nextStepScheduled: true,
      operationId: 'op-1',
      pendingApproval: ['t1'],
      pendingPrompt: { id: 'p1' },
      status: 'waiting_for_human',
      stepIndex: 2,
      success: true,
      totalCost: 0.42,
      totalSteps: 5,
      waitingForHuman: true,
    });
  });

  it('returns 500 on unexpected service errors and echoes operationId', async () => {
    mockGetOperationMetadata.mockResolvedValue({ userId: 'user-1' });
    mockExecuteStep.mockRejectedValue(new Error('boom'));

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(500);
    expect(getCaptures()[0].body).toMatchObject({
      error: 'boom',
      operationId: 'op-1',
      stepIndex: 2,
    });
  });
});

describe('runStepHealth handler', () => {
  it('returns a healthy payload', () => {
    const captures: any[] = [];
    const ctx = {
      json: (b: any, status = 200) => {
        captures.push({ body: b, status });
        return Response.json(b, { status });
      },
    } as any;

    const res = runStepHealth(ctx);

    expect(res.status).toBe(200);
    expect(captures[0].body).toMatchObject({
      healthy: true,
      message: 'Agent execution service is running',
    });
  });
});

describe('runStep inline step loop', () => {
  const metadata = { userId: 'user-1', workspaceId: 'ws-1' };
  const doneState = { cost: { total: 0 }, status: 'done', stepCount: 4 };

  const continuationFor = (stepIndex: number) => ({
    context: { phase: 'llm_result', step: stepIndex },
    delay: 50,
    operationId: 'op-1',
    priority: 'normal' as const,
    stepIndex,
  });

  beforeEach(() => {
    // This is a separate top-level describe, so it does not inherit the reset
    // above — without these, one test's stub leaks into the next.
    mockGetOperationMetadata.mockReset();
    mockExecuteStep.mockReset();
    mockScheduleContinuation.mockReset();
    mockReleaseOperationLock.mockReset();
    mockClearInlineResume.mockReset();
    mockLoadInlineResume.mockReset();
    mockLoadInlineResume.mockResolvedValue(null);
    mockInlineStepsEnabled.mockReset();
    mockInlineStepsEnabled.mockResolvedValue(true);
    mockGetServerDB.mockResolvedValue({} as any);
    mockGetOperationMetadata.mockResolvedValue(metadata);
  });

  it('runs consecutive steps in one invocation instead of re-queueing each one', async () => {
    // The whole point of the loop: three steps, zero queue round-trips.
    mockExecuteStep
      .mockResolvedValueOnce({
        continuation: continuationFor(3),
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 3 },
        success: true,
      })
      .mockResolvedValueOnce({
        continuation: continuationFor(4),
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 4 },
        success: true,
      })
      .mockResolvedValueOnce({
        nextStepScheduled: false,
        state: doneState,
        success: true,
      });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(200);
    expect(mockExecuteStep).toHaveBeenCalledTimes(3);
    expect(mockScheduleContinuation).not.toHaveBeenCalled();
    expect(getCaptures()[0].body).toMatchObject({
      completed: true,
      inlinedSteps: 2,
      nextStepScheduled: false,
      // The response reports the last step actually executed, not the delivered one.
      stepIndex: 4,
    });
  });

  it('carries the delivery payload on the first step only', async () => {
    // Human input / approvals / retry counters describe THIS delivery. Replaying
    // them on an inlined step would re-apply an approval that already ran.
    mockExecuteStep
      .mockResolvedValueOnce({
        continuation: continuationFor(3),
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 3 },
        success: true,
      })
      .mockResolvedValueOnce({ nextStepScheduled: false, state: doneState, success: true });

    const { ctx } = buildContext({
      body: { ...validBody, approvedToolCall: { id: 'call-1' }, humanInput: 'yes' },
      retried: '2',
    });
    await runStep(ctx);

    expect(mockExecuteStep.mock.calls[0][0]).toMatchObject({
      approvedToolCall: { id: 'call-1' },
      externalRetryCount: 2,
      humanInput: 'yes',
      stepIndex: 2,
    });
    const second = mockExecuteStep.mock.calls[1][0];
    expect(second.approvedToolCall).toBeUndefined();
    expect(second.humanInput).toBeUndefined();
    expect(second.externalRetryCount).toBeUndefined();
    expect(second.stepIndex).toBe(3);
  });

  it('holds one lock owner across every inlined step and releases it once', async () => {
    mockExecuteStep
      .mockResolvedValueOnce({
        continuation: continuationFor(3),
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 3 },
        success: true,
      })
      .mockResolvedValueOnce({ nextStepScheduled: false, state: doneState, success: true });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    for (const [params] of mockExecuteStep.mock.calls) {
      expect(params).toMatchObject({ retainStepLock: true, stepLockOwner: 'op-1:owner' });
    }
    expect(mockReleaseOperationLock).toHaveBeenCalledTimes(1);
    expect(mockReleaseOperationLock).toHaveBeenCalledWith('op-1', 'op-1:owner');
  });

  it('hands the pending step back to the queue once the deadline passes', async () => {
    let clock = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const pending = continuationFor(3);

    mockExecuteStep.mockImplementation(async () => {
      // Burn the whole inline budget inside the first step.
      clock += 600_000;
      return {
        continuation: pending,
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 3 },
        success: true,
      };
    });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(200);
    expect(mockExecuteStep).toHaveBeenCalledTimes(1);
    expect(mockScheduleContinuation).toHaveBeenCalledWith(pending);
    expect(getCaptures()[0].body).toMatchObject({ nextStepScheduled: true, nextStepIndex: 3 });
    expect(mockReleaseOperationLock).toHaveBeenCalledWith('op-1', 'op-1:owner');
    nowSpy.mockRestore();
  });

  it('releases the lock when a step throws', async () => {
    // Without this the operation stays locked for the full TTL and every
    // redelivery bounces off it.
    mockExecuteStep.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});

    const { ctx } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(500);
    expect(mockReleaseOperationLock).toHaveBeenCalledWith('op-1', 'op-1:owner');
    errorSpy.mockRestore();
  });

  it('resumes from a parked envelope left behind by a dead inline loop', async () => {
    // Without this the delivered (older) step index hits the stepCount > stepIndex
    // stale-delivery guard, gets ACKed, and the operation stalls forever with
    // nothing queued behind it — the inline loop never published a message.
    const parked = continuationFor(7);
    mockLoadInlineResume.mockResolvedValue(parked);
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: doneState,
      success: true,
    });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    await runStep(ctx);

    const params = mockExecuteStep.mock.calls[0][0];
    expect(params.stepIndex).toBe(7);
    expect(params.context).toEqual(parked.context);
    expect(getCaptures()[0].body).toMatchObject({ stepIndex: 7 });
  });

  it('keeps the delivery retry count when resuming a parked step', async () => {
    // A step that parked for approval but failed to persist its Review is only
    // replayed while `externalRetryCount > 0`. Dropping it on the resume path
    // lets the stale-delivery guard ACK the step, and the approval never
    // becomes available.
    mockLoadInlineResume.mockResolvedValue(continuationFor(7));
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: doneState,
      success: true,
    });

    const { ctx } = buildContext({ body: validBody, retried: '2' });
    await runStep(ctx);

    expect(mockExecuteStep.mock.calls[0][0]).toMatchObject({
      externalRetryCount: 2,
      stepIndex: 7,
    });
  });

  it('fails the delivery when the parked envelope cannot be read', async () => {
    // Treating an unreadable envelope as an absent one would run the delivered
    // (older) step, get ACKed as stale, and strand the operation. A 500 lets the
    // queue retry instead.
    mockLoadInlineResume.mockRejectedValue(new Error('redis down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});

    const { ctx } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(500);
    expect(mockExecuteStep).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('never redirects a purpose-carrying delivery to a parked envelope', async () => {
    // The group-member timeout watchdog is scheduled on the member operation at
    // stepIndex 0, so any envelope would be "ahead" of it. Redirecting it would
    // drop the watchdog payload AND delete the running loop's recovery pointer.
    // Same reasoning for approvals, resumes and barrier probes.
    const purposeful = [
      { approvedToolCall: { id: 'call-1' } },
      { finishAfterAsyncTool: true },
      { groupMemberTimeout: { memberOperationId: 'op-member' } },
      { humanInput: 'yes' },
      { rejectAndContinue: true },
      { rejectionReason: 'nope' },
      { resumeAsyncTool: true },
      { toolMessageId: 'msg-1' },
      { verifyAsyncToolBarrier: true },
    ];
    mockLoadInlineResume.mockResolvedValue(continuationFor(7));
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: doneState,
      success: true,
    });

    for (const payload of purposeful) {
      mockExecuteStep.mockClear();
      mockClearInlineResume.mockClear();

      const { ctx } = buildContext({ body: { ...validBody, ...payload } });
      await runStep(ctx);

      expect(mockExecuteStep.mock.calls[0][0]).toMatchObject({ stepIndex: 2, ...payload });
      // The envelope belongs to whoever is actually looping; this delivery must
      // not clear it on the way past.
      expect(mockClearInlineResume).not.toHaveBeenCalled();
    }
  });

  it('scopes the envelope clear to this invocation lock owner', async () => {
    // A delivery can read envelope k, stall while the live worker finishes k and
    // parks k+1, then be told its step is stale. Clearing unconditionally there
    // would delete the live worker's newer recovery pointer.
    mockLoadInlineResume.mockResolvedValue(continuationFor(7));
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: doneState,
      success: true,
    });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(mockClearInlineResume).toHaveBeenCalledWith('op-1', 'op-1:owner');
  });

  it('ignores a parked envelope that is not ahead of the delivered step', async () => {
    // After a deadline hand-off the queued message carries the same index the
    // envelope named. That delivery is authoritative, payload and all.
    mockLoadInlineResume.mockResolvedValue(continuationFor(2));
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: false,
      state: doneState,
      success: true,
    });

    const { ctx } = buildContext({ body: { ...validBody, humanInput: 'yes' } });
    await runStep(ctx);

    expect(mockExecuteStep.mock.calls[0][0]).toMatchObject({
      humanInput: 'yes',
      stepIndex: 2,
    });
  });

  it('drops the parked envelope when the pending step goes back to the queue', async () => {
    // Otherwise the envelope and the queued message both point at the same step,
    // and a late redelivery could run it a second time.
    let clock = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    mockExecuteStep.mockImplementation(async () => {
      clock += 600_000;
      return {
        continuation: continuationFor(3),
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 3 },
        success: true,
      };
    });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(mockScheduleContinuation).toHaveBeenCalledTimes(1);
    expect(mockClearInlineResume).toHaveBeenCalledWith('op-1', 'op-1:owner');
    nowSpy.mockRestore();
  });

  it('runs one step per delivery when the rollout flag is off', async () => {
    mockInlineStepsEnabled.mockResolvedValue(false);
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: true,
      state: { status: 'running', stepCount: 3 },
      success: true,
    });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(mockInlineStepsEnabled).toHaveBeenCalledWith('user-1');
    expect(mockExecuteStep).toHaveBeenCalledTimes(1);
    expect(mockExecuteStep.mock.calls[0][0]).toMatchObject({ inlineContinuation: false });
    expect(getCaptures()[0].body).toMatchObject({ inlinedSteps: 0, nextStepScheduled: true });
  });

  it('still honours a parked envelope after the flag is switched off', async () => {
    // Operations that were mid-loop when the flag flipped have an envelope and
    // nothing queued behind them. Ignoring it would strand exactly the runs the
    // rollback was meant to protect.
    mockInlineStepsEnabled.mockResolvedValue(false);
    mockLoadInlineResume.mockResolvedValue(continuationFor(7));
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: true,
      state: { status: 'running', stepCount: 8 },
      success: true,
    });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(mockExecuteStep.mock.calls[0][0]).toMatchObject({
      inlineContinuation: false,
      stepIndex: 7,
    });
    // The queue owns the next step again, so the envelope must not linger.
    expect(mockClearInlineResume).toHaveBeenCalledWith('op-1', 'op-1:owner');
  });

  it('leaves Redis alone when nothing was ever parked', async () => {
    mockInlineStepsEnabled.mockResolvedValue(false);
    mockExecuteStep.mockResolvedValue({
      nextStepScheduled: true,
      state: { status: 'running', stepCount: 3 },
      success: true,
    });

    const { ctx } = buildContext({ body: validBody });
    await runStep(ctx);

    expect(mockClearInlineResume).not.toHaveBeenCalled();
  });

  it('stops the loop and reports success when another worker takes the lock mid-run', async () => {
    mockExecuteStep
      .mockResolvedValueOnce({
        continuation: continuationFor(3),
        nextStepScheduled: false,
        state: { status: 'running', stepCount: 3 },
        success: true,
      })
      .mockResolvedValueOnce({ locked: true, nextStepScheduled: false, state: {}, success: false });

    const { ctx, getCaptures } = buildContext({ body: validBody });
    const res = await runStep(ctx);

    expect(res.status).toBe(200);
    expect(mockScheduleContinuation).not.toHaveBeenCalled();
    expect(getCaptures()[0].body).toMatchObject({ inlinedSteps: 1 });
  });
});
