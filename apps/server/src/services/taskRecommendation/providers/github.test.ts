// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createGitHubTaskRecommendationProvider } from './github';

/** @example Reviewer-only GitHub activity still supplies a source the writer can cite. */
describe('createGitHubTaskRecommendationProvider', () => {
  /** @example A contribution repository becomes an allowed GitHub source URL. */
  it('attaches repository URLs to contribution signals', async () => {
    const provider = createGitHubTaskRecommendationProvider();
    const result = await provider.collect({
      connectorData: {
        getGitHubClient: vi.fn(async () => ({
          listRecentContributions: vi.fn(async () => [
            {
              repository: 'lobehub/lobehub',
              title: 'Reviewed pull request',
              type: 'pull_request_review' as const,
            },
          ]),
          listRecentPullRequests: vi.fn(async () => []),
          listRecentRepositories: vi.fn(async () => []),
        })),
      },
    } as never);

    expect(result.signalCount).toBe(1);
    expect(result.sources).toEqual([{ type: 'github', url: 'https://github.com/lobehub/lobehub' }]);
  });
});
