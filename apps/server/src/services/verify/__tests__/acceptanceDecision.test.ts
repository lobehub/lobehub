// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const mocks = vi.hoisted(() => ({
  attachToAcceptance: vi.fn(),
  findById: vi.fn(),
  findOwnTopicById: vi.fn(),
  findPolicyById: vi.fn(),
  findReportByRun: vi.fn(),
  findRunById: vi.fn(),
  ensureForSubject: vi.fn(),
  listByAcceptance: vi.fn(),
  setDecision: vi.fn(),
  taskResolve: vi.fn(),
  updateStatus: vi.fn(),
  updatePolicyStatus: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(() => ({
    ensureForSubject: mocks.ensureForSubject,
    findById: mocks.findById,
    findPolicyById: mocks.findPolicyById,
    updatePolicyStatus: mocks.updatePolicyStatus,
    updateStatus: mocks.updateStatus,
  })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    attachToAcceptance: mocks.attachToAcceptance,
    findById: mocks.findRunById,
    listByAcceptance: mocks.listByAcceptance,
    setDecision: mocks.setDecision,
  })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({ VerifyCheckResultModel: vi.fn() }));
vi.mock('@/database/models/verifyEvidence', () => ({ VerifyEvidenceModel: vi.fn() }));
vi.mock('@/database/models/verifyReport', () => ({
  VerifyReportModel: vi.fn(() => ({ findByRun: mocks.findReportByRun })),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({ resolve: mocks.taskResolve })),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({ findOwnTopicById: mocks.findOwnTopicById })),
}));
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
    mocks.findPolicyById.mockImplementation((...args) => mocks.findById(...args));
    mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1', roundIndex: 1 }]);
  });

  it('creates a standalone acceptance without resolving a LobeHub task, topic, or document', async () => {
    mocks.ensureForSubject.mockResolvedValue({ id: 'acc-standalone' });

    await service().ensureForSubject('standalone', 'external-delivery-1', {
      requirement: 'The external delivery works',
      title: 'External delivery',
    });

    expect(mocks.taskResolve).not.toHaveBeenCalled();
    expect(mocks.ensureForSubject).toHaveBeenCalledWith('standalone', 'external-delivery-1', {
      metadata: { title: 'External delivery' },
      projectId: null,
      requirement: 'The external delivery works',
    });
  });

  it('treats an agent-share visitor topic as a non-existent subject', async () => {
    // findOwnTopicById excludes visitor topics, so it resolves null here even
    // though the id exists as a raw row — the creator must not be able to
    // attach an acceptance to a visitor's conversation.
    mocks.findOwnTopicById.mockResolvedValue(undefined);

    await expect(
      service().ensureForSubject('topic', 'tpc-visitor-1', { requirement: 'The topic works' }),
    ).rejects.toThrow('topic "tpc-visitor-1" not found in the current workspace');
    expect(mocks.ensureForSubject).not.toHaveBeenCalled();
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

  it.each(['accepted', 'closed'])(
    'refuses to attach a new round after the acceptance is %s',
    async (status) => {
      mocks.findById.mockResolvedValue(acceptance(status));
      mocks.findRunById.mockResolvedValue({ acceptanceId: null, id: 'run-2' });

      await expect(service().attachRun('run-2', 'acc-1')).rejects.toThrow(`already been ${status}`);
      expect(mocks.attachToAcceptance).not.toHaveBeenCalled();
    },
  );

  it('keeps an already-attached run idempotent after acceptance', async () => {
    mocks.findById.mockResolvedValue(acceptance('accepted'));
    const existing = { acceptanceId: 'acc-1', id: 'run-1', roundIndex: 1 };
    mocks.findRunById.mockResolvedValue(existing);

    await expect(service().attachRun('run-1', 'acc-1')).resolves.toBe(existing);
    expect(mocks.attachToAcceptance).not.toHaveBeenCalled();
  });

  it('attaches a workspace task run through internal policy scope', async () => {
    mocks.findPolicyById.mockResolvedValue(acceptance('planned'));
    mocks.findRunById.mockResolvedValue({ acceptanceId: null, id: 'run-2' });
    mocks.attachToAcceptance.mockResolvedValue({
      acceptanceId: 'acc-1',
      id: 'run-2',
      roundIndex: 2,
    });

    await expect(service().attachPolicyRun('run-2', 'acc-1')).resolves.toMatchObject({
      acceptanceId: 'acc-1',
    });
    expect(mocks.attachToAcceptance).toHaveBeenCalledWith('run-2', 'acc-1', undefined);
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
