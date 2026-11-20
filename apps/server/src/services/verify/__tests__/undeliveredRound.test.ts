// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseUndeliveredRound } from '../undeliveredRound';

const m = vi.hoisted(() => ({
  op: vi.fn(),
  run: vi.fn(),
  detach: vi.fn(),
  recompute: vi.fn(),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: m.op };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { detachUndeliveredRound: m.detach, findByOperation: m.run };
  }),
}));
vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(function () {
    return { recomputeStatus: m.recompute };
  }),
}));

const db = {} as any;
const round = { id: 'run', acceptanceId: 'acceptance', roundIndex: 9, status: 'planned' };

describe('releaseUndeliveredRound', () => {
  beforeEach(() => {
    Object.values(m).forEach((mock) => mock.mockReset());
    m.op.mockResolvedValue({ parentOperationId: null, status: 'error' });
    m.run.mockResolvedValue(round);
    m.detach.mockResolvedValue(true);
  });

  it.each(['error', 'abandoned', 'interrupted'])(
    'takes the round of a task run that ended %s off the acceptance',
    async (status) => {
      m.op.mockResolvedValue({ parentOperationId: null, status });
      expect(await releaseUndeliveredRound(db, 'user', 'op', 'ws')).toBe(true);
      expect(m.detach).toHaveBeenCalledWith('run');
      // The acceptance follows its latest round, so it must be re-derived from
      // the rounds that remain.
      expect(m.recompute).toHaveBeenCalledWith('acceptance');
    },
  );

  it.each(['done', 'running', 'idle'])('keeps the round of a run that is %s', async (status) => {
    m.op.mockResolvedValue({ parentOperationId: null, status });
    expect(await releaseUndeliveredRound(db, 'user', 'op')).toBe(false);
    expect(m.detach).not.toHaveBeenCalled();
  });

  it('leaves repairs to settleFailedRepair', async () => {
    m.op.mockResolvedValue({ parentOperationId: 'parent', status: 'error' });
    expect(await releaseUndeliveredRound(db, 'user', 'op')).toBe(false);
    expect(m.run).not.toHaveBeenCalled();
  });

  it.each([
    ['no round', null],
    ['a round off any acceptance', { ...round, acceptanceId: null }],
    ['a round that already started judging', { ...round, status: 'verifying' }],
  ])('does nothing for %s', async (_, run) => {
    m.run.mockResolvedValue(run);
    expect(await releaseUndeliveredRound(db, 'user', 'op')).toBe(false);
    expect(m.detach).not.toHaveBeenCalled();
  });

  it('does not recompute when the round was judged in the meantime', async () => {
    m.detach.mockResolvedValue(false);
    expect(await releaseUndeliveredRound(db, 'user', 'op')).toBe(false);
    expect(m.recompute).not.toHaveBeenCalled();
  });
});
