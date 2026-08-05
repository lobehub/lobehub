// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { processOnboardingTaskRecommendations } from './process';

const payload = {
  responseLanguage: 'en-US',
  sessionId: 'session-1',
  sourceFingerprint: 'github@1,gmail@1',
  topicId: 'topic-1',
  userId: 'user-1',
};

/** @example Provider failures remain isolated inside one durable recommendation run. */
describe('processOnboardingTaskRecommendations', () => {
  /** @example Gmail failure still commits successful GitHub recommendations as a partial result. */
  it('runs providers independently and commits bounded failures', async () => {
    const steps: string[] = [];
    const service = {
      begin: vi.fn(async () => ({ limit: 5, providerIds: ['github', 'gmail'], ready: true })),
      commit: vi.fn(async (_topicId, _sessionId, results) => ({ results, status: 'partial' })),
      generateProvider: vi.fn(async (providerId: string) => {
        if (providerId === 'gmail') throw new Error('gmail unavailable');
        return { providerId, recommendations: [{ id: 'github-1' }] };
      }),
      get: vi.fn(),
    };
    const context = {
      requestPayload: payload,
      run: async <Result>(name: string, action: () => Promise<Result>) => {
        steps.push(name);
        return action();
      },
    };

    const result = await processOnboardingTaskRecommendations(context as never, {
      createService: async () => service as never,
    });

    expect(result).toMatchObject({ status: 'partial' });
    expect(steps).toEqual([
      'session:begin',
      'provider:github:generate',
      'provider:gmail:generate',
      'session:commit',
    ]);
    expect(service.commit).toHaveBeenCalledWith(
      'topic-1',
      'session-1',
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'github' }),
        expect.objectContaining({
          error: expect.objectContaining({ code: 'TASK_RECOMMENDATION_PROVIDER_FAILED' }),
          providerId: 'gmail',
        }),
      ]),
    );
  });
});
