// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  hasActiveWatcher: vi.fn(),
  listByAcceptance: vi.fn(),
  mergeDecisionDetail: vi.fn(),
  publishResourceEvent: vi.fn(),
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
    mergeDecisionDetail: mocks.mergeDecisionDetail,
    setDecision: mocks.setDecision,
  })),
}));
vi.mock('@/server/services/resourceEvents', () => ({
  publishResourceEvent: mocks.publishResourceEvent,
}));
vi.mock('@/server/services/verify/acceptanceWatchers', () => ({
  hasActiveAcceptanceWatcher: mocks.hasActiveWatcher,
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
    mocks.hasActiveWatcher.mockResolvedValue(true);
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

  it('keeps a manually closed acceptance terminal during status recomputation', async () => {
    mocks.findById.mockResolvedValue(acceptance('closed'));

    await expect(service().recomputeStatus('acc-1')).resolves.toBe('closed');
    expect(mocks.listByAcceptance).not.toHaveBeenCalled();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
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
    expect(mocks.publishResourceEvent).toHaveBeenCalledWith(
      { id: 'acc-1', type: 'acceptance' },
      { actorId: 'user-1', type: 'acceptance.accepted' },
    );
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
    expect(mocks.publishResourceEvent).toHaveBeenCalledWith(
      { id: 'acc-1', type: 'acceptance' },
      expect.objectContaining({
        data: { roundIndex: 1 },
        type: 'acceptance.feedbackSubmitted',
      }),
    );
  });

  it('submits accumulated feedback once and reports an active watcher', async () => {
    mocks.findById.mockResolvedValue(acceptance('delivered'));

    const result = await service().submitFeedback('acc-1');

    expect(mocks.mergeDecisionDetail).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ feedbackSubmittedBy: 'user-1' }),
    );
    expect(mocks.updateStatus).toHaveBeenCalledWith('acc-1', 'repairing');
    expect(result).toMatchObject({ alreadySubmitted: false, roundIndex: 1, watcherActive: true });
    expect(mocks.publishResourceEvent).toHaveBeenCalledWith(
      { id: 'acc-1', type: 'acceptance' },
      expect.objectContaining({ type: 'acceptance.feedbackSubmitted' }),
    );
  });

  it('does not rewrite or redispatch fallback work when feedback was already submitted', async () => {
    mocks.findById.mockResolvedValue(acceptance('repairing'));
    mocks.listByAcceptance.mockResolvedValue([
      {
        decisionDetail: { feedbackSubmittedAt: '2026-07-28T08:00:00.000Z' },
        id: 'run-1',
        roundIndex: 1,
      },
    ]);
    mocks.hasActiveWatcher.mockResolvedValue(false);

    const result = await service().submitFeedback('acc-1');

    expect(result).toMatchObject({ alreadySubmitted: true, watcherActive: false });
    expect(mocks.mergeDecisionDetail).not.toHaveBeenCalled();
  });
});
