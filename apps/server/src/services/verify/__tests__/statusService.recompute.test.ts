// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyStatusService } from '../statusService';

const { runFindByOperation, runUpdateStatus, resultListByRun } = vi.hoisted(() => ({
  resultListByRun: vi.fn(),
  runFindByOperation: vi.fn(),
  runUpdateStatus: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    findByOperation: runFindByOperation,
    updateStatus: runUpdateStatus,
  })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({ listByRun: resultListByRun })),
}));

const db = {} as any;

// One confirmed run whose plan is the given required check items.
const runWith = (items: { id: string }[]) => ({
  id: 'run-1',
  plan: items.map((i) => ({ ...i, required: true })),
  planConfirmedAt: new Date(),
  status: 'verifying',
});

describe('VerifyStatusService.recompute — errored rollup', () => {
  beforeEach(() => {
    [runFindByOperation, runUpdateStatus, resultListByRun].forEach((m) => m.mockReset());
  });

  it('an errored required check (none failed) rolls up to `errored`, not `failed`', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }]));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'errored', verdict: null }]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('errored');
    expect(runUpdateStatus).toHaveBeenCalledWith('run-1', 'errored');
  });

  it('a genuine failure dominates an errored check (delivery still gates)', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }, { id: 'c2' }]));
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'errored', verdict: null },
      { checkItemId: 'c2', status: 'failed', verdict: 'failed' },
    ]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('failed');
  });

  it('a still-running check keeps the run `verifying` even with an errored sibling', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }, { id: 'c2' }]));
    resultListByRun.mockResolvedValue([
      { checkItemId: 'c1', status: 'errored', verdict: null },
      { checkItemId: 'c2', status: 'running', verdict: null },
    ]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('verifying');
  });

  it('all passing required checks still roll up to `passed`', async () => {
    runFindByOperation.mockResolvedValue(runWith([{ id: 'c1' }]));
    resultListByRun.mockResolvedValue([{ checkItemId: 'c1', status: 'passed', verdict: 'passed' }]);

    const status = await new VerifyStatusService(db, 'u1').recompute('op-1');

    expect(status).toBe('passed');
  });
});
