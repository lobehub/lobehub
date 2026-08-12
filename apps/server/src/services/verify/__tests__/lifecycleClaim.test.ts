// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runVerifyOnCompletion } from '../lifecycle';
import { VERIFY_ABANDONED_MS } from '../staleness';

const { claimVerifying, execute, findByOperation, operationFindById, finalizeVerifyRun } =
  vi.hoisted(() => ({
    claimVerifying: vi.fn(),
    execute: vi.fn(),
    finalizeVerifyRun: vi.fn(),
    findByOperation: vi.fn(),
    operationFindById: vi.fn(),
  }));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ findByOperation })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: operationFindById })),
}));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    getPinnedDocuments: vi.fn().mockResolvedValue([]),
    resolveVerifyConfig: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(() => ({ claimVerifying })),
}));
vi.mock('../executor', () => ({ VerifyExecutorService: vi.fn(() => ({ execute })) }));
vi.mock('../agentVerifier', () => ({ createVerifierAgentRunner: vi.fn(() => vi.fn()) }));
vi.mock('../modelConfig', () => ({
  resolveVerifyModelConfig: vi.fn().mockResolvedValue({ model: 'm', provider: 'p' }),
}));
vi.mock('../settle', () => ({ finalizeVerifyRun }));

const db = {} as any;
const params = { deliverable: 'done', goal: 'ship it', operationId: 'op-1' };

const confirmedRun = { id: 'run-1', plan: [{ id: 'c1' }], planConfirmedAt: new Date() };

describe('runVerifyOnCompletion — verification claim', () => {
  beforeEach(() => {
    [claimVerifying, execute, finalizeVerifyRun, findByOperation, operationFindById].forEach((m) =>
      m.mockReset(),
    );
    findByOperation.mockResolvedValue(confirmedRun);
    operationFindById.mockResolvedValue({ id: 'op-1', model: 'm', provider: 'p', taskId: null });
    claimVerifying.mockResolvedValue(true);
  });

  it('claims the run with the abandoned bound rather than reading its status', async () => {
    const before = Date.now();
    await runVerifyOnCompletion(db, 'u1', params);

    expect(execute).toHaveBeenCalledTimes(1);
    const [operationId, staleBefore] = claimVerifying.mock.calls[0];
    expect(operationId).toBe('op-1');
    // The window the claim treats as abandoned, not "now".
    expect(staleBefore.getTime()).toBeGreaterThanOrEqual(before - VERIFY_ABANDONED_MS - 1000);
    expect(staleBefore.getTime()).toBeLessThanOrEqual(Date.now() - VERIFY_ABANDONED_MS + 1000);
  });

  it('does not judge when another completion already holds the claim', async () => {
    // A redelivered terminal step: the first one is mid-judge, this one must not
    // start a second pass over the same plan.
    claimVerifying.mockResolvedValue(false);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(execute).not.toHaveBeenCalled();
    expect(finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('still skips runs that never opted in', async () => {
    findByOperation.mockResolvedValue({ id: 'run-1', plan: [{ id: 'c1' }], planConfirmedAt: null });

    await runVerifyOnCompletion(db, 'u1', params);

    expect(claimVerifying).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
