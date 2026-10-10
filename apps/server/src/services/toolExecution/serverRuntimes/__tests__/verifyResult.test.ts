import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyResultRuntime } from '../verifyResult';

const mocks = vi.hoisted(() => ({
  operationFindById: vi.fn(),
  runFindByOperation: vi.fn(),
  resultUpdateByCheckItem: vi.fn(),
  resultListByRun: vi.fn(),
  statusRecompute: vi.fn(),
  finalizeVerifyRun: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.operationFindById };
  }),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn().mockImplementation(function () {
    return {
      listByRun: mocks.resultListByRun,
      updateByCheckItem: mocks.resultUpdateByCheckItem,
    };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn().mockImplementation(function () {
    return { findByOperation: mocks.runFindByOperation };
  }),
}));

vi.mock('@/server/services/verify', () => ({
  finalizeVerifyRun: mocks.finalizeVerifyRun,
  VerifyStatusService: vi.fn().mockImplementation(function () {
    return { recompute: mocks.statusRecompute };
  }),
}));

const factoryContext = {
  operationId: 'op-verifier-child',
  serverDB: {} as never,
  userId: 'user-1',
  workspaceId: 'ws-1',
} as never;

const buildRuntime = () =>
  (verifyResultRuntime.factory as unknown as (ctx: typeof factoryContext) => {
    submitVerifyResult: (params: unknown) => Promise<{ content: string; error?: string; success: boolean }>;
  })(factoryContext);

describe('verifyResultRuntime.submitVerifyResult', () => {
  let runtime: ReturnType<typeof buildRuntime>;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = buildRuntime();
  });

  it('loud-fails with NO_PARENT_VERIFICATION when the calling op has no parent', async () => {
    mocks.operationFindById.mockResolvedValue(null);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'derived-id',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PARENT_VERIFICATION');
    expect(result.content).toContain('No parent verification context');
    expect(mocks.runFindByOperation).not.toHaveBeenCalled();
  });

  it('returns an actionable NO_RUN message when the parent run has no verification session', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue(null);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'derived-id',
      verdict: 'passed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_RUN');
    // The message must name the escape hatch instead of the bare opaque error.
    expect(result.content).toContain('report your verdict in your reply');
    expect(mocks.resultUpdateByCheckItem).not.toHaveBeenCalled();
  });

  it('returns an idempotent receipt instead of overwriting an already-terminal verdict', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1' });
    mocks.resultListByRun.mockResolvedValue([
      {
        checkItemId: 'check-1',
        status: 'failed',
        verdict: 'failed',
      },
    ]);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('already recorded');
    expect(mocks.resultUpdateByCheckItem).not.toHaveBeenCalled();
    expect(mocks.statusRecompute).not.toHaveBeenCalled();
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('still records a fresh verdict and finalizes the run when no prior result exists', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'op-parent' });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1' });
    mocks.resultListByRun.mockResolvedValue([]);
    mocks.resultUpdateByCheckItem.mockResolvedValue(undefined);
    mocks.statusRecompute.mockResolvedValue(undefined);
    mocks.finalizeVerifyRun.mockResolvedValue(undefined);

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-2',
      evidence: 'tests pass',
      reasoning: 'unit tests green',
      verdict: 'passed',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Recorded verdict');
    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'check-2',
      expect.objectContaining({ status: 'passed', verdict: 'passed' }),
    );
    expect(mocks.statusRecompute).toHaveBeenCalledWith('op-parent');
    expect(mocks.finalizeVerifyRun).toHaveBeenCalled();
  });
});
