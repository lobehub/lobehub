// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  scmEnv: {
    ENABLED_GITHUB_APP: true,
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'key',
  },
}));

vi.mock('@/envs/scm', () => ({ scmEnv: mocks.scmEnv }));
vi.mock('octokit', () => ({
  App: vi.fn().mockImplementation(function () {
    return { getInstallationOctokit: async () => ({ request: mocks.request }) };
  }),
}));

const { fetchGitHubReviewFeedback, resetGitHubApp } = await import('../app');

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const review = (id: number, submittedAt: string) => ({
  author_association: 'MEMBER',
  body: `review ${id}`,
  html_url: `https://github.com/o/r/pull/1#r${id}`,
  state: 'COMMENTED',
  submitted_at: submittedAt,
  user: { login: 'reviewer' },
});

/** Three pages of reviews; only the last page is inside the wake window. */
const pages: Record<number, ReturnType<typeof review>[]> = {
  1: [review(1, at(600)), review(2, at(590))],
  2: [review(3, at(500)), review(4, at(480))],
  3: [review(5, at(5)), review(6, at(2))],
};

describe('fetchGitHubReviewFeedback', () => {
  beforeEach(() => {
    resetGitHubApp();
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (route: string, params: Record<string, unknown>) => {
      if (route.endsWith('/comments')) return { data: [], headers: {} };
      const page = Number(params.page ?? 1);
      return {
        data: pages[page] ?? [],
        headers: {
          link: '<https://api.github.com/repositories/1/pulls/1/reviews?page=3>; rel="last"',
        },
      };
    });
  });

  it('walks back from the last page so recent reviews on a long pull request still reach the prompt', async () => {
    const feedback = await fetchGitHubReviewFeedback({
      installationId: '1',
      number: 1,
      repoFullName: 'o/r',
      since: new Date(NOW - 15 * 60_000),
    });

    // Page one alone would have yielded nothing: its reviews are hours old.
    expect(feedback.map((item) => item.body)).toEqual(['review 5', 'review 6']);
    const requested = mocks.request.mock.calls
      .filter(([route]) => route.endsWith('/reviews'))
      .map(([, params]) => params.page ?? 1);
    // Page one is the probe that carries the `rel="last"` link; the walk
    // then runs backwards from the end and stops at the first page that
    // starts before the window.
    expect(requested).toEqual([1, 3, 2]);
  });

  it('reads one page when the pull request has only one', async () => {
    mocks.request.mockImplementation(async (route: string) =>
      route.endsWith('/comments')
        ? { data: [], headers: {} }
        : { data: [review(9, at(1))], headers: {} },
    );

    const feedback = await fetchGitHubReviewFeedback({
      installationId: '1',
      number: 1,
      repoFullName: 'o/r',
      since: new Date(NOW - 15 * 60_000),
    });

    expect(feedback.map((item) => item.body)).toEqual(['review 9']);
    expect(mocks.request.mock.calls.filter(([route]) => route.endsWith('/reviews'))).toHaveLength(
      1,
    );
  });
});
