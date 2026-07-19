// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listByAcceptance: vi.fn(),
  setDecision: vi.fn(),
  taskResolve: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(() => ({
    findById: mocks.findById,
    updateStatus: mocks.updateStatus,
  })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    listByAcceptance: mocks.listByAcceptance,
    setDecision: mocks.setDecision,
  })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({ VerifyCheckResultModel: vi.fn() }));
vi.mock('@/database/models/verifyEvidence', () => ({ VerifyEvidenceModel: vi.fn() }));
vi.mock('@/database/models/verifyReport', () => ({ VerifyReportModel: vi.fn() }));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({ resolve: mocks.taskResolve })),
}));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const service = () => new AcceptanceService({} as any, 'user-1');

const acceptance = (status: string) => ({
  id: 'acc-1',
  status,
  subjectId: 'tpc-1',
  subjectType: 'topic',
});

describe('AcceptanceService decision gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1', roundIndex: 1 }]);
  });

  it.each(['pending', 'planned', 'verifying', 'repairing'])(
    'refuses to accept while the round chain is still %s',
    async (status) => {
      mocks.findById.mockResolvedValue(acceptance(status));

      await expect(service().accept('acc-1')).rejects.toThrow('still in progress');
      expect(mocks.setDecision).not.toHaveBeenCalled();
      expect(mocks.updateStatus).not.toHaveBeenCalled();
    },
  );

  it('refuses to decide twice', async () => {
    mocks.findById.mockResolvedValue(acceptance('accepted'));
    await expect(service().accept('acc-1')).rejects.toThrow('already been accepted');

    mocks.findById.mockResolvedValue(acceptance('rejected'));
    await expect(service().reject('acc-1', 'again')).rejects.toThrow('re-opens it');
    expect(mocks.setDecision).not.toHaveBeenCalled();
  });

  it.each(['delivered', 'errored'])('accepts a settled (%s) delivery', async (status) => {
    mocks.findById.mockResolvedValue(acceptance(status));

    await service().accept('acc-1', 'looks good');

    expect(mocks.setDecision).toHaveBeenCalledWith(
      'run-1',
      'accept',
      expect.objectContaining({ comment: 'looks good', decidedBy: 'user-1' }),
    );
    expect(mocks.updateStatus).toHaveBeenCalledWith('acc-1', 'accepted');
  });

  it('rejects a settled delivery with the re-tasking comment', async () => {
    mocks.findById.mockResolvedValue(acceptance('delivered'));

    await service().reject('acc-1', 'dark mode needs a screenshot');

    expect(mocks.setDecision).toHaveBeenCalledWith(
      'run-1',
      'reject',
      expect.objectContaining({ comment: 'dark mode needs a screenshot' }),
    );
    expect(mocks.updateStatus).toHaveBeenCalledWith('acc-1', 'rejected');
  });
});
