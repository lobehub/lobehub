// @vitest-environment node
import type { OnboardingTaskRecommendationSession } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { TaskRecommendationConfigurator } from './config';
import { TaskRecommendationService } from './service';

const session: OnboardingTaskRecommendationSession = {
  completedAt: '2026-07-30T00:00:00.000Z',
  createdTaskIds: {},
  errors: [],
  id: 'session-1',
  providerIds: ['github'],
  recommendations: [
    {
      checked: true,
      id: 'recommendation-1',
      instruction: 'Review the pull request and propose the next step.',
      providerId: 'github',
      reason: 'The pull request was updated recently.',
      sources: [
        { type: 'github', url: 'https://github.com/lobehub/lobe-chat/pull/1' },
        { type: 'github', url: 'https://github.com/lobehub/lobe-chat/issues/2' },
      ],
      title: 'Review the open pull request',
    },
  ],
  sourceFingerprint: 'github@1',
  status: 'completed',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

/** @example Recommendations are grounded and materialize only once. */
describe('TaskRecommendationService', () => {
  /** @example GitHub completion starts both selected connectors before writing finishes. */
  it('initializes from the first completed source without waiting for Understanding writing', async () => {
    let persisted: OnboardingTaskRecommendationSession | undefined;
    const service = new TaskRecommendationService({
      configurator: new TaskRecommendationConfigurator(),
      connectorData: {},
      onboarding: {},
      providers: new Map([
        ['github', { collect: vi.fn(), id: 'github' }],
        ['gmail', { collect: vi.fn(), id: 'gmail' }],
      ]),
      task: {},
      topic: {
        findById: vi.fn(async () => ({
          metadata: {
            onboardingSession: {
              taskRecommendations: persisted,
              understanding: {
                id: 'session-1',
                sources: {
                  github: {
                    errors: [],
                    failedCount: 0,
                    revision: 1,
                    status: 'completed',
                    succeededCount: 1,
                  },
                  gmail: {
                    errors: [],
                    failedCount: 0,
                    revision: 1,
                    status: 'running',
                    succeededCount: 0,
                  },
                },
              },
            },
          },
        })),
        updateMetadata: vi.fn(async (_topicId, patch) => {
          persisted = patch.onboardingSession!.taskRecommendations!;
        }),
      },
      writer: {},
    } as never);

    // ROOT CAUSE:
    //
    // Recommendation initialization previously required writing.status === 'completed', so the
    // task workflow could only start after the Understanding writer rather than beside it.
    // The source workflow already supplies the exact completed fingerprint, which is sufficient.
    await expect(service.begin('topic-1', 'session-1', 'github@1')).resolves.toMatchObject({
      providerIds: ['github', 'gmail'],
      ready: true,
    });
    expect(persisted).toMatchObject({
      sourceFingerprint: 'github@1',
      status: 'processing',
    });
  });

  /** @example Invented links are discarded while multiple exact connector links survive. */
  it('keeps multiple source URLs supplied by connector evidence', async () => {
    const service = new TaskRecommendationService({
      configurator: new TaskRecommendationConfigurator(),
      connectorData: {},
      onboarding: {},
      providers: new Map([
        [
          'github',
          {
            collect: vi.fn(async () => ({
              context: '{"sourceUrl":"https://github.com/lobehub/lobe-chat/pull/1"}',
              diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
              signalCount: 1,
              sources: [
                { type: 'github', url: 'https://github.com/lobehub/lobe-chat/pull/1' },
                { type: 'github', url: 'https://github.com/lobehub/lobe-chat/issues/2' },
              ],
            })),
            id: 'github',
          },
        ],
      ]),
      task: {},
      topic: {},
      userId: 'user-1',
      writer: {
        generate: vi.fn(async () => [
          {
            instruction: 'Review the pull request.',
            reason: 'It changed recently.',
            sourceUrls: [
              'https://github.com/lobehub/lobe-chat/pull/1',
              'https://github.com/lobehub/lobe-chat/issues/2',
              'https://example.com/invented',
            ],
            title: 'Review the pull request',
          },
        ]),
      },
    } as never);

    const result = await service.generateProvider('github', 2, 'en-US');
    expect(result.recommendations[0].sources).toEqual([
      { type: 'github', url: 'https://github.com/lobehub/lobe-chat/pull/1' },
      { type: 'github', url: 'https://github.com/lobehub/lobe-chat/issues/2' },
    ]);
  });

  /** @example A recommendation supported only by an invented URL is not exposed to the user. */
  it('discards recommendations without an exact connector source', async () => {
    const service = new TaskRecommendationService({
      configurator: new TaskRecommendationConfigurator(),
      connectorData: {},
      onboarding: {},
      providers: new Map([
        [
          'github',
          {
            collect: vi.fn(async () => ({
              context: '{"sourceUrl":"https://github.com/lobehub/lobe-chat/pull/1"}',
              diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
              signalCount: 1,
              sources: [{ type: 'github', url: 'https://github.com/lobehub/lobe-chat/pull/1' }],
            })),
            id: 'github',
          },
        ],
      ]),
      task: {},
      topic: {},
      userId: 'user-1',
      writer: {
        generate: vi.fn(async () => [
          {
            instruction: 'Review an unsupported source.',
            reason: 'It may need attention.',
            sourceUrls: ['https://example.com/invented'],
            title: 'Review unsupported work',
          },
        ]),
      },
    } as never);

    await expect(service.generateProvider('github', 2, 'en-US')).resolves.toMatchObject({
      error: { code: 'TASK_RECOMMENDATION_GENERATION_EMPTY' },
      recommendations: [],
    });
  });

  /** @example Repeating the same create request reuses the persisted task mapping. */
  it('does not create duplicate tasks when materialization is retried', async () => {
    let persisted = structuredClone(session);
    const materialize = vi.fn(async ({ recommendationId }: { recommendationId: string }) => {
      persisted.createdTaskIds[recommendationId] ??= 'task-1';
      return { status: 'success' as const, taskId: persisted.createdTaskIds[recommendationId] };
    });
    const service = new TaskRecommendationService({
      configurator: new TaskRecommendationConfigurator(),
      connectorData: {},
      materializer: { materialize },
      onboarding: { getInboxAgentId: vi.fn(async () => 'inbox-1') },
      providers: new Map(),
      topic: {
        findById: vi.fn(async () => ({
          metadata: { onboardingSession: { taskRecommendations: persisted } },
        })),
        updateMetadata: vi.fn(async (_topicId, patch) => {
          persisted = patch.onboardingSession!.taskRecommendations!;
        }),
      },
      userId: 'user-1',
      writer: {},
    } as never);
    const input = {
      recommendationIds: ['recommendation-1'],
      sessionId: 'session-1',
      topicId: 'topic-1',
    };

    await service.createTasks(input);
    await service.createTasks(input);

    expect(materialize).toHaveBeenCalledTimes(2);
    expect(materialize).toHaveBeenCalledWith({
      assigneeAgentId: 'inbox-1',
      recommendationId: 'recommendation-1',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    expect(persisted.createdTaskIds).toEqual({ 'recommendation-1': 'task-1' });
  });
});
