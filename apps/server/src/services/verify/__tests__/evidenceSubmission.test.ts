// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  recordHeterogeneousDeliverableEvidence,
  startEvidenceSubmission,
} from '../evidenceSubmission';

const { createMany, execAgent, findByOperation, listByRun, upsertByCheckItem } = vi.hoisted(() => ({
  createMany: vi.fn(),
  execAgent: vi.fn(),
  findByOperation: vi.fn(),
  listByRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { upsertByCheckItem };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { createMany, listByRun };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation };
  }),
}));

describe('startEvidenceSubmission', () => {
  beforeEach(() => {
    execAgent.mockReset().mockResolvedValue({ operationId: 'evidence-op' });
    findByOperation.mockReset().mockResolvedValue({ id: 'run-1' });
    upsertByCheckItem.mockReset().mockResolvedValue({ id: 'result-1' });
    createMany.mockReset().mockResolvedValue(undefined);
    listByRun.mockReset().mockResolvedValue([]);
  });

  it('records the heterogeneous builder deliverable as inline evidence for every criterion', async () => {
    await recordHeterogeneousDeliverableEvidence({
      db: {} as any,
      deliverable: 'artifact path and sha-256',
      operation: { id: 'work-op' } as any,
      plan: [
        {
          id: 'criterion-1',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Artifact exists',
          verifierConfig: {},
          verifierType: 'llm',
        },
      ],
      userId: 'user-1',
    });

    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'work-op', verifyRunId: 'run-1' }),
    );
    expect(createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        capturedBy: 'agent',
        content: 'artifact path and sha-256',
        type: 'text',
      }),
    ]);
  });

  it('leaves criteria the builder already evidenced untouched', async () => {
    listByRun.mockResolvedValue([{ checkItemId: 'criterion-1', type: 'transcript' }]);

    await recordHeterogeneousDeliverableEvidence({
      db: {} as any,
      deliverable: 'the whole final report',
      operation: { id: 'work-op' } as any,
      plan: [
        {
          id: 'criterion-1',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Evidenced by the builder',
          verifierConfig: {},
          verifierType: 'llm',
        },
        {
          id: 'criterion-2',
          index: 1,
          onFail: 'manual',
          required: true,
          title: 'Left without evidence',
          verifierConfig: {},
          verifierType: 'llm',
        },
      ],
      userId: 'user-1',
    });

    expect(listByRun).toHaveBeenCalledWith('run-1');
    expect(upsertByCheckItem).toHaveBeenCalledTimes(1);
    expect(upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ checkItemId: 'criterion-2' }),
    );
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('continues as the original builder in the same topic with only the evidence tool', async () => {
    const operation = {
      agentId: 'builder-agent',
      id: 'work-op',
      taskId: 'task-1',
      topicId: 'topic-1',
    } as any;

    await startEvidenceSubmission({
      db: {} as any,
      deliverable: 'artifact summary',
      goal: 'ship model',
      operation,
      plan: [
        {
          id: 'criterion-1',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Model artifact exists',
          verifierConfig: {},
          verifierType: 'llm',
        },
      ],
      userId: 'user-1',
    });

    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        exclusivePluginIds: ['lobe-acceptance-evidence'],
        agentId: 'builder-agent',
        appContext: { taskId: 'task-1', topicId: 'topic-1' },
        parentOperationId: 'work-op',
        suppressUserMessage: true,
      }),
    );
    const call = execAgent.mock.calls[0][0];
    expect(call.ephemeralUserMessage).toContain('criterion-1: Model artifact exists');
    expect(call.prompt).toBe(call.ephemeralUserMessage);
    expect(call.prompt.trim()).not.toBe('');
    expect(call.userInterventionConfig).toEqual({ approvalMode: 'headless' });
    expect(call.hooks[0].webhook.body).toMatchObject({
      deliverable: 'artifact summary',
      goal: 'ship model',
      parentOperationId: 'work-op',
      userId: 'user-1',
    });
  });

  it('rejects operations that cannot preserve builder identity and topic context', async () => {
    await expect(
      startEvidenceSubmission({
        db: {} as any,
        deliverable: '',
        goal: '',
        operation: { id: 'work-op' } as any,
        plan: [],
        userId: 'user-1',
      }),
    ).rejects.toThrow('no builder agent or topic');
    expect(execAgent).not.toHaveBeenCalled();
  });
});
