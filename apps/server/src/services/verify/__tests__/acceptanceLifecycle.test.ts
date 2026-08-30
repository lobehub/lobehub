// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instantiateVerifyPlanOnStart } from '../planInstantiation';
import { createRepairRunner } from '../repairService';

const mocks = vi.hoisted(() => ({
  acceptanceAttachPolicyRun: vi.fn(),
  acceptanceEnsureForSubject: vi.fn(),
  acceptanceUpdate: vi.fn(),
  agentExec: vi.fn(),
  confirmPlan: vi.fn(),
  ensureForOperation: vi.fn(),
  generateDraftPlan: vi.fn(),
  operationFindById: vi.fn(),
  runFindByOperation: vi.fn(),
  setMetadata: vi.fn(),
  setPlan: vi.fn(),
  taskFindById: vi.fn(),
  taskAcceptanceResolve: vi.fn(),
}));

vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(() => ({
    acceptanceModel: { update: mocks.acceptanceUpdate },
    attachPolicyRun: mocks.acceptanceAttachPolicyRun,
    ensureForSubject: mocks.acceptanceEnsureForSubject,
  })),
}));

vi.mock('../planGenerator', () => ({
  VerifyPlanGeneratorService: vi.fn(() => ({
    generateDraftPlan: mocks.generateDraftPlan,
  })),
}));

vi.mock('../taskAcceptance', () => ({
  resolveTaskAcceptance: mocks.taskAcceptanceResolve,
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    findById: mocks.taskFindById,
  })),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    confirmPlan: mocks.confirmPlan,
    ensureForOperation: mocks.ensureForOperation,
    findByOperation: mocks.runFindByOperation,
    setMetadata: mocks.setMetadata,
    setPlan: mocks.setPlan,
  })),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: mocks.operationFindById })),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ execAgent: mocks.agentExec })),
}));

const db = {} as any;
const plan = [{ id: 'check-1', required: true }];

describe('Verify acceptance lifecycle', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('attaches the verify run to the task acceptance that owns its policy', async () => {
    mocks.taskAcceptanceResolve.mockResolvedValue({
      acceptance: { id: 'acceptance-1' },
      config: { enabled: true },
      requirement: 'The novel is complete and coherent',
    });
    mocks.taskFindById.mockResolvedValue({
      instruction: 'Write a science-fiction novel',
      name: 'Novel',
    });
    mocks.runFindByOperation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'run-1', plan });

    await instantiateVerifyPlanOnStart(
      db,
      'user-1',
      { operationId: 'operation-1', taskId: 'task-1' },
      'workspace-1',
    );

    expect(mocks.acceptanceAttachPolicyRun).toHaveBeenCalledWith('run-1', 'acceptance-1');
  });

  it('keeps an empty Acceptance opted out of verification', async () => {
    mocks.taskAcceptanceResolve.mockResolvedValue({
      acceptance: { id: 'acceptance-1' },
      config: {},
    });

    await instantiateVerifyPlanOnStart(db, 'user-1', {
      operationId: 'operation-1',
      taskId: 'task-1',
    });

    expect(mocks.generateDraftPlan).not.toHaveBeenCalled();
  });

  it('attaches an auto-repair verify run as the next round of the same acceptance', async () => {
    mocks.operationFindById.mockResolvedValue({ parentOperationId: null });
    mocks.agentExec.mockResolvedValue({ operationId: 'repair-operation' });
    mocks.runFindByOperation.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      id: 'source-run',
      metadata: { maxRepairRounds: 2 },
      plan,
    });
    mocks.ensureForOperation.mockResolvedValue({ id: 'repair-run' });

    const runner = createRepairRunner({
      agentId: 'agent-1',
      db,
      maxRepairRounds: 2,
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    const result = await runner!({
      failedItemIds: ['check-1'],
      instruction: 'Fix the failed check',
      operationId: 'source-operation',
    });

    expect(result).toEqual({ repairOperationId: 'repair-operation' });
    expect(mocks.agentExec).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1' }));
    expect(mocks.acceptanceAttachPolicyRun).toHaveBeenCalledWith('repair-run', 'acceptance-1');
  });
});
