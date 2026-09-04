// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runVerifyAfterEvidenceSubmission, runVerifyOnCompletion } from '../lifecycle';
import { VERIFY_ABANDONED_MS } from '../staleness';

const {
  claimEvidenceCollection,
  claimVerifying,
  execute,
  evidenceListByRun,
  findByOperation,
  operationFindById,
  finalizeVerifyRun,
  recordHeterogeneousDeliverableEvidence,
  startEvidenceSubmission,
  updateStatus,
} = vi.hoisted(() => ({
  claimEvidenceCollection: vi.fn(),
  claimVerifying: vi.fn(),
  evidenceListByRun: vi.fn(),
  execute: vi.fn(),
  finalizeVerifyRun: vi.fn(),
  findByOperation: vi.fn(),
  operationFindById: vi.fn(),
  recordHeterogeneousDeliverableEvidence: vi.fn(),
  startEvidenceSubmission: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    claimEvidenceCollection,
    findByOperation,
    updateStatus,
  })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: operationFindById })),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(() => ({ listByRun: evidenceListByRun })),
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
vi.mock('../evidenceSubmission', () => ({
  recordHeterogeneousDeliverableEvidence,
  startEvidenceSubmission,
}));
vi.mock('../taskAcceptance', () => ({
  resolveTaskAcceptance: vi.fn().mockResolvedValue({ config: { enabled: true } }),
}));

const db = {} as any;
const params = { deliverable: 'done', goal: 'ship it', operationId: 'op-1' };

const confirmedRun = {
  id: 'run-1',
  plan: [{ id: 'c1', required: true }],
  planConfirmedAt: new Date(),
  status: 'planned',
};

describe('runVerifyOnCompletion — verification claim', () => {
  beforeEach(() => {
    [
      claimEvidenceCollection,
      claimVerifying,
      evidenceListByRun,
      execute,
      finalizeVerifyRun,
      findByOperation,
      operationFindById,
      recordHeterogeneousDeliverableEvidence,
      startEvidenceSubmission,
      updateStatus,
    ].forEach((m) => m.mockReset());
    findByOperation.mockResolvedValue(confirmedRun);
    operationFindById.mockResolvedValue({ id: 'op-1', model: 'm', provider: 'p', taskId: null });
    claimVerifying.mockResolvedValue(true);
    evidenceListByRun.mockResolvedValue([]);
  });

  it('still collects when the builder covered only part of a multi-criterion plan', async () => {
    // "any evidence row exists" would strand c2 at the structural gate with no
    // chance to supply what it asks for.
    findByOperation.mockResolvedValue({
      ...confirmedRun,
      plan: [
        { id: 'c1', required: true },
        { id: 'c2', required: true },
      ],
    });
    operationFindById.mockResolvedValue({
      agentId: 'builder',
      id: 'op-1',
      model: 'm',
      provider: 'p',
      taskId: 'task-1',
      topicId: 'topic-1',
    });
    evidenceListByRun.mockResolvedValue([{ checkItemId: 'c1', type: 'text' }]);
    claimEvidenceCollection.mockResolvedValue(true);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(startEvidenceSubmission).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('still collects when a criterion is missing a declared evidence type', async () => {
    findByOperation.mockResolvedValue({
      ...confirmedRun,
      plan: [
        {
          id: 'c1',
          required: true,
          verifierConfig: { requiredEvidence: [{ type: 'screenshot' }] },
        },
      ],
    });
    operationFindById.mockResolvedValue({
      agentId: 'builder',
      id: 'op-1',
      model: 'm',
      provider: 'p',
      taskId: 'task-1',
      topicId: 'topic-1',
    });
    evidenceListByRun.mockResolvedValue([{ checkItemId: 'c1', type: 'text' }]);
    claimEvidenceCollection.mockResolvedValue(true);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(startEvidenceSubmission).toHaveBeenCalledTimes(1);
  });

  it('judges directly when the builder already submitted evidence inside the Task run', async () => {
    operationFindById.mockResolvedValue({
      agentId: 'builder',
      id: 'op-1',
      model: 'm',
      provider: 'p',
      taskId: 'task-1',
      topicId: 'topic-1',
    });
    evidenceListByRun.mockResolvedValue([{ checkItemId: 'c1', type: 'screenshot' }]);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(claimEvidenceCollection).not.toHaveBeenCalled();
    expect(startEvidenceSubmission).not.toHaveBeenCalled();
    expect(claimVerifying).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('starts builder evidence collection before judging a task-bound run', async () => {
    operationFindById.mockResolvedValue({
      agentId: 'builder',
      id: 'op-1',
      model: 'm',
      provider: 'p',
      taskId: 'task-1',
      topicId: 'topic-1',
    });
    claimEvidenceCollection.mockResolvedValue(true);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(startEvidenceSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ operation: expect.objectContaining({ id: 'op-1' }) }),
    );
    expect(claimVerifying).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('records a heterogeneous builder handoff directly and continues to verification', async () => {
    operationFindById.mockResolvedValue({
      agentId: 'builder',
      id: 'op-1',
      model: null,
      provider: 'kimi-code',
      taskId: 'task-1',
      topicId: 'topic-1',
    });
    claimEvidenceCollection.mockResolvedValue(true);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(recordHeterogeneousDeliverableEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        deliverable: 'done',
        operation: expect.objectContaining({ id: 'op-1' }),
      }),
    );
    expect(startEvidenceSubmission).not.toHaveBeenCalled();
    expect(claimVerifying).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not let a redelivered task completion bypass active evidence collection', async () => {
    findByOperation.mockResolvedValue({ ...confirmedRun, status: 'collecting_evidence' });
    operationFindById.mockResolvedValue({ id: 'op-1', taskId: 'task-1' });
    claimEvidenceCollection.mockResolvedValue(false);

    await runVerifyOnCompletion(db, 'u1', params);

    expect(claimVerifying).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets only evidence completion advance collection into verification', async () => {
    findByOperation.mockResolvedValue({ ...confirmedRun, status: 'collecting_evidence' });
    operationFindById.mockResolvedValue({
      id: 'op-1',
      model: 'm',
      provider: 'p',
      taskId: 'task-1',
    });

    await runVerifyAfterEvidenceSubmission(db, 'u1', params);

    expect(claimVerifying).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps an interrupted evidence verification retryable until it can be reclaimed', async () => {
    findByOperation.mockResolvedValue({ ...confirmedRun, status: 'verifying' });
    operationFindById.mockResolvedValue({ id: 'op-1', taskId: 'task-1' });
    claimVerifying.mockResolvedValue(false);

    await expect(runVerifyAfterEvidenceSubmission(db, 'u1', params)).rejects.toThrow(
      'still in progress',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates evidence verification failures so the queue retries them', async () => {
    findByOperation.mockResolvedValue({ ...confirmedRun, status: 'collecting_evidence' });
    operationFindById.mockResolvedValue({ id: 'op-1', taskId: 'task-1' });
    execute.mockRejectedValue(new Error('judge unavailable'));

    await expect(runVerifyAfterEvidenceSubmission(db, 'u1', params)).rejects.toThrow(
      'judge unavailable',
    );
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
