// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startEvidenceSubmission } from '../evidenceSubmission';

const { execAgent } = vi.hoisted(() => ({ execAgent: vi.fn() }));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ execAgent })),
}));

describe('startEvidenceSubmission', () => {
  beforeEach(() => {
    execAgent.mockReset().mockResolvedValue({ operationId: 'evidence-op' });
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
