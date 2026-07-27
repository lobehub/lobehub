// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instantiateVerifyPlanOnStart } from '../planInstantiation';
import { createRepairRunner } from '../repairService';

const mocks = vi.hoisted(() => ({
  acceptanceAttachRun: vi.fn(),
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
  taskResolveVerifyConfig: vi.fn(),
}));

vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(() => ({
    acceptanceModel: { update: mocks.acceptanceUpdate },
    attachRun: mocks.acceptanceAttachRun,
    ensureForSubject: mocks.acceptanceEnsureForSubject,
  })),
}));

vi.mock('../planGenerator', () => ({
  VerifyPlanGeneratorService: vi.fn(() => ({
    generateDraftPlan: mocks.generateDraftPlan,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    findById: mocks.taskFindById,
    resolveVerifyConfig: mocks.taskResolveVerifyConfig,
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

  it('creates and attaches the task acceptance when its verify plan is confirmed', async () => {
    mocks.taskResolveVerifyConfig.mockResolvedValue({
      enabled: true,
      requirement: 'The novel is complete and coherent',
    });
    mocks.taskFindById.mockResolvedValue({
      instruction: 'Write a science-fiction novel',
      name: 'Novel',
    });
    mocks.runFindByOperation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'run-1', plan });
    mocks.acceptanceEnsureForSubject.mockResolvedValue({ id: 'acceptance-1' });

    await instantiateVerifyPlanOnStart(
      db,
      'user-1',
      { operationId: 'operation-1', taskId: 'task-1' },
      'workspace-1',
    );

    expect(mocks.acceptanceEnsureForSubject).toHaveBeenCalledWith('task', 'task-1', {
      requirement: 'The novel is complete and coherent',
    });
    expect(mocks.acceptanceUpdate).toHaveBeenCalledWith('acceptance-1', {
      requirement: 'The novel is complete and coherent',
    });
    expect(mocks.acceptanceAttachRun).toHaveBeenCalledWith('run-1', 'acceptance-1');
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
    expect(mocks.acceptanceAttachRun).toHaveBeenCalledWith('repair-run', 'acceptance-1');
  });
});
