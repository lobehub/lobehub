// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linearCommentAuthor, linearCommentToContent } from '../issueComments';
import { type LinearIssueComment, listLinearIssueComments } from '../issues';

vi.mock('@/envs/linear', () => ({
  linearEnv: { ENABLED_LINEAR: true, LINEAR_CLIENT_ID: 'client', LINEAR_CLIENT_SECRET: 'secret' },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));

const comment = (overrides: Partial<LinearIssueComment> = {}): LinearIssueComment => ({
  body: '首付款 20%',
  createdAt: '2026-01-02T03:04:05.000Z',
  id: 'c1',
  issueId: 'issue-1',
  url: 'https://linear.app/acme/issue/PM-40#comment-c1',
  user: { displayName: 'JianXu', name: 'Jian Xu' },
  ...overrides,
});

describe('linearCommentToContent', () => {
  it('credits the Linear author and links back to the comment', () => {
    expect(linearCommentToContent(comment())).toBe(
      '> **JianXu** on [Linear](https://linear.app/acme/issue/PM-40#comment-c1)\n\n首付款 20%',
    );
  });

  it('marks a reply and keeps a name from becoming markdown', () => {
    expect(
      linearCommentToContent(
        comment({ body: '  ok  ', parentId: 'c0', user: { displayName: 'a_b*', name: 'x' } }),
      ),
    ).toBe(
      '> **a\\_b\\*** replied on [Linear](https://linear.app/acme/issue/PM-40#comment-c1)\n\nok',
    );
  });

  it('keeps only the credit line for an empty body', () => {
    expect(linearCommentToContent(comment({ body: '   ' }))).toBe(
      '> **JianXu** on [Linear](https://linear.app/acme/issue/PM-40#comment-c1)',
    );
  });
});

describe('linearCommentAuthor', () => {
  it('falls back from a member to an outside user, an integration, then Linear', () => {
    expect(linearCommentAuthor(comment({ user: { displayName: '', name: 'Jian Xu' } }))).toBe(
      'Jian Xu',
    );
    expect(linearCommentAuthor(comment({ externalUser: { name: 'Customer' }, user: null }))).toBe(
      'Customer',
    );
    expect(
      linearCommentAuthor(
        comment({ botActor: { name: 'GitHub', userDisplayName: 'octocat' }, user: null }),
      ),
    ).toBe('octocat');
    expect(linearCommentAuthor(comment({ botActor: { name: 'GitHub' }, user: null }))).toBe(
      'GitHub',
    );
    expect(linearCommentAuthor(comment({ user: null }))).toBe('Linear');
  });
});

describe('listLinearIssueComments', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const page = (nodes: LinearIssueComment[], endCursor?: string) =>
    new Response(
      JSON.stringify({
        data: { comments: { nodes, pageInfo: { endCursor, hasNextPage: !!endCursor } } },
      }),
      { headers: { 'content-type': 'application/json' }, status: 200 },
    );

  const variables = (call: number) =>
    JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string).variables;

  it('reads every page for each batch of issues and returns them oldest first', async () => {
    const issueIds = Array.from({ length: 51 }, (_, index) => `issue-${index}`);
    fetchMock
      .mockResolvedValueOnce(page([comment({ createdAt: '2026-03-01T00:00:00Z', id: 'c3' })], 'n'))
      .mockResolvedValueOnce(page([comment({ createdAt: '2026-01-01T00:00:00Z', id: 'c1' })]))
      .mockResolvedValueOnce(page([comment({ createdAt: '2026-02-01T00:00:00Z', id: 'c2' })]));

    const comments = await listLinearIssueComments('token', [...issueIds, 'issue-0']);

    expect(comments.map((item) => item.id)).toEqual(['c1', 'c2', 'c3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(variables(0).filter.issue.id.in).toHaveLength(50);
    expect(variables(0).after).toBeUndefined();
    expect(variables(1).after).toBe('n');
    expect(variables(1).filter.issue.id.in).toHaveLength(50);
    expect(variables(2).filter.issue.id.in).toEqual(['issue-50']);
  });

  it('asks Linear nothing for no issues', async () => {
    expect(await listLinearIssueComments('token', [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
