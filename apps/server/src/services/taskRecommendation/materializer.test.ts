// @vitest-environment node
import type { OnboardingTaskRecommendationSession } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskRecommendationMaterializer } from './materializer';

const recommendationSession = (): OnboardingTaskRecommendationSession => ({
  completedAt: '2026-07-30T00:00:00.000Z',
  createdTaskIds: {},
  errors: [],
  id: 'session-1',
  providerIds: ['github'],
  recommendations: [
    {
      checked: true,
      id: 'recommendation-1',
      instruction: 'Inspect the pull request without writing to GitHub.',
      providerId: 'github',
      reason: 'A'.repeat(300),
      sources: [
        { type: 'github', url: 'https://github.com/lobehub/lobehub/pull/1' },
        { subject: 'CI result', type: 'gmail', url: 'gmail:thread:1' },
        {
          title: 'Launch plan',
          type: 'notion',
          url: 'https://www.notion.so/launch-plan',
        },
      ],
      title: 'Inspect the pull request state',
    },
  ],
  sourceFingerprint: 'github@1',
  status: 'completed',
  updatedAt: '2026-07-30T00:00:00.000Z',
});

/** @example Materialization persists task creation and its idempotency mapping together. */
describe('TaskRecommendationMaterializer', () => {
  /** @example A replay returns the mapped task while preserving bounded task fields. */
  it('creates and records one task for sequential retries', async () => {
    const row = {
      metadata: { onboardingSession: { taskRecommendations: recommendationSession() } },
    };
    const transaction = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ for: vi.fn(async () => [row]) })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(({ metadata }) => ({
          where: vi.fn(async () => {
            row.metadata = metadata;
          }),
        })),
      })),
    };
    const database = {
      transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as LobeChatDatabase;
    const createTask = vi.fn(async () => ({ id: 'task-1' }));
    const materializer = new TaskRecommendationMaterializer(database, 'user-1', createTask);
    const input = {
      assigneeAgentId: 'inbox-1',
      recommendationId: 'recommendation-1',
      sessionId: 'session-1',
      topicId: 'topic-1',
    };

    await expect(materializer.materialize(input)).resolves.toEqual({
      created: true,
      status: 'success',
      taskId: 'task-1',
    });
    await expect(materializer.materialize(input)).resolves.toEqual({
      created: false,
      status: 'success',
      taskId: 'task-1',
    });

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: 'A'.repeat(255),
        instruction: [
          'Inspect the pull request without writing to GitHub.',
          '',
          'Sources:',
          '- https://github.com/lobehub/lobehub/pull/1',
          '- CI result: gmail:thread:1',
          '- Launch plan: https://www.notion.so/launch-plan',
        ].join('\n'),
      }),
    );
    expect(row.metadata.onboardingSession.taskRecommendations.createdTaskIds).toEqual({
      'recommendation-1': 'task-1',
    });
  });
});
