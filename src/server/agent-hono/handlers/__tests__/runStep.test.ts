// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runStep, runStepHealth } from '../runStep';

const mockGetOperationMetadata = vi.fn();
const mockExecuteStep = vi.fn();

vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({
    getOperationMetadata: mockGetOperationMetadata,
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    executeStep: mockExecuteStep,
  })),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({} as any),
}));

function buildContext(opts: { body?: unknown; jsonThrows?: boolean; retried?: string }) {
  const captures: Array<{ body: any; status: number; headers?: Record<string, string> }> = [];
  const ctx = {
    json: (b: any, status = 200, headers?: Record<string, string>) => {
      captures.push({ body: b, status, headers });
      return Response.json(b, { status, headers });
    },
    req: {
      header: (name: string) =>
        name.toLowerCase() === 'upstash-retried' ? opts.retried : undefined,
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
    mockExecuteStep.mockReset();
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
    const { ctx, getCaptures } = buildContext({ body: validBody });

    const res = await runStep(ctx);

    expect(res.status).toBe(401);
    expect(getCaptures()[0].body).toEqual({ error: 'Invalid operation or unauthorized' });
    expect(mockExecuteStep).not.toHaveBeenCalled();
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
