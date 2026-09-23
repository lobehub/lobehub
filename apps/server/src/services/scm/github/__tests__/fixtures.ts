/**
 * Trimmed GitHub webhook payloads: only the fields the normalizer reads, with
 * the same nesting GitHub uses. Values are stable so tests can assert on them.
 */

export const repository = {
  full_name: 'lobehub/lobehub',
  id: 601_000_001,
  private: false,
};

export const installation = { id: 90_001 };

export const sender = { id: 42, login: 'arvinxx' };

export const pullRequest = (overrides: Record<string, unknown> = {}) => ({
  base: { ref: 'canary' },
  body: 'Closes the loop.\n\n- Acceptance: https://app.lobehub.com/acceptance/0f1e2d3c-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
  closed_at: null,
  draft: false,
  head: { ref: 'feat/scm-github-app', sha: 'a'.repeat(40) },
  html_url: 'https://github.com/lobehub/lobehub/pull/19719',
  merged: false,
  merged_at: null,
  merged_by: null,
  mergeable: true,
  mergeable_state: 'clean',
  node_id: 'PR_kwDO1',
  number: 19_719,
  state: 'open',
  title: 'feat(scm): GitHub App core',
  updated_at: '2026-09-20T06:00:00Z',
  user: { id: 42, login: 'arvinxx' },
  ...overrides,
});

export const pullRequestEvent = (action: string, overrides: Record<string, unknown> = {}) => ({
  action,
  installation,
  pull_request: pullRequest(overrides),
  repository,
  sender,
});

export const checkRunEvent = (overrides: Record<string, unknown> = {}) => ({
  action: 'completed',
  check_run: {
    completed_at: '2026-09-20T06:05:00Z',
    conclusion: 'failure',
    details_url: 'https://github.com/lobehub/lobehub/actions/runs/1/job/2',
    head_sha: 'a'.repeat(40),
    html_url: 'https://github.com/lobehub/lobehub/runs/2',
    id: 2,
    name: 'Test Packages',
    pull_requests: [{ number: 19_719 }],
    started_at: '2026-09-20T06:01:00Z',
    status: 'completed',
    ...overrides,
  },
  installation,
  repository,
});

export const reviewEvent = (state: string) => ({
  action: 'submitted',
  installation,
  pull_request: { number: 19_719 },
  repository,
  review: {
    author_association: 'COLLABORATOR',
    body: 'Please split the handler.',
    html_url: 'https://github.com/lobehub/lobehub/pull/19719#pullrequestreview-7',
    id: 7,
    state,
    submitted_at: '2026-09-20T06:10:00Z',
    user: { id: 77, login: 'chatgpt-codex-connector[bot]' },
  },
});

export const reviewCommentEvent = () => ({
  action: 'created',
  comment: {
    body: 'This guard is inverted.',
    created_at: '2026-09-20T06:11:00Z',
    html_url: 'https://github.com/lobehub/lobehub/pull/19719#discussion_r9',
    id: 9,
    line: 42,
    path: 'apps/server/src/services/scm/ScmIngestService.ts',
    user: { id: 77, login: 'chatgpt-codex-connector[bot]' },
  },
  installation,
  pull_request: { number: 19_719 },
  repository,
});

export const installationEvent = (action: string) => ({
  action,
  installation: {
    account: {
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
      id: 1,
      login: 'lobehub',
      type: 'Organization',
    },
    events: ['pull_request', 'check_run'],
    id: installation.id,
    permissions: { checks: 'write', pull_requests: 'write' },
    repository_selection: 'selected',
    suspended_at: null,
  },
  repositories: [repository],
  sender,
});

export const installationRepositoriesEvent = () => ({
  action: 'added',
  installation,
  repositories_added: [{ full_name: 'lobehub/lobehub-cloud', id: 601_000_002, private: true }],
  repositories_removed: [repository],
  sender,
});

export const statusEvent = (state: string) => ({
  context: 'ci/circleci',
  installation,
  repository,
  sha: 'a'.repeat(40),
  state,
  target_url: 'https://circleci.com/gh/lobehub/lobehub/1',
  updated_at: '2026-09-20T06:06:00Z',
});
