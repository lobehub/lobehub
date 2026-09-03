// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listByAcceptance: vi.fn(),
  mergeRounds: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../acceptanceMerge', () => ({ mergeAcceptanceRounds: mocks.mergeRounds }));
vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(() => ({
    findById: mocks.findById,
    updateStatus: mocks.updateStatus,
  })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ listByAcceptance: mocks.listByAcceptance })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({ VerifyCheckResultModel: vi.fn() }));
vi.mock('@/database/models/verifyEvidence', () => ({ VerifyEvidenceModel: vi.fn() }));
vi.mock('@/database/models/verifyReport', () => ({ VerifyReportModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/goal', () => ({ GoalModel: vi.fn() }));
vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('../goalLoop', () => ({
  maybeContinueGoalLoop: vi.fn(),
  syncGoalToolState: vi.fn(),
}));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const SUMMARY = { movedChecks: 3, movedRounds: 1, rekeyedChecks: 1 };

const service = () => new AcceptanceService({} as any, 'user-1');

const row = (id: string, status = 'delivered') => ({ id, status, subjectType: 'standalone' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mergeRounds.mockResolvedValue(SUMMARY);
  mocks.listByAcceptance.mockResolvedValue([]);
  mocks.findById.mockImplementation(async (id: string) => row(id));
});

describe('AcceptanceService.merge', () => {
  it('refuses to merge an acceptance into itself', async () => {
    await expect(service().merge('acc-1', 'acc-1')).rejects.toThrow(/into itself/);
    expect(mocks.mergeRounds).not.toHaveBeenCalled();
  });

  it('refuses a target whose delivery is already settled', async () => {
    mocks.findById.mockImplementation(async (id: string) =>
      id === 'target' ? row('target', 'accepted') : row(id),
    );

    await expect(service().merge('source', 'target')).rejects.toThrow(/reopen it/);
    expect(mocks.mergeRounds).not.toHaveBeenCalled();
  });

  it('still reports success when the post-commit status recompute fails', async () => {
    // The merge has COMMITTED and the source is gone by then — surfacing this as
    // a failed mutation would offer a retry that can only ever 404.
    mocks.listByAcceptance.mockRejectedValue(new Error('connection reset'));

    await expect(service().merge('source', 'target')).resolves.toEqual(SUMMARY);
  });
});
