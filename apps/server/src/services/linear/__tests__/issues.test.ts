// @vitest-environment node
import { LINEAR_NO_PROJECT_ID } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countLinearIssues,
  getLinearIssuesByIds,
  getLinearProjectTeamIds,
  listLinearIssues,
} from '../issues';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

const requestBody = (call: unknown[]) =>
  JSON.parse((call[1] as RequestInit).body as string) as {
    query: string;
    variables: Record<string, any>;
  };

const emptyIssues = { issues: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } } };

describe('listLinearIssues filter', () => {
  it('filters by team when no project is chosen', async () => {
    fetchMock.mockResolvedValue(reply(emptyIssues));

    await listLinearIssues('token', { stateTypes: ['unstarted'], teamId: 'team-pkg' });

    expect(requestBody(fetchMock.mock.calls[0]).variables.filter).toEqual({
      state: { type: { in: ['unstarted'] } },
      team: { id: { eq: 'team-pkg' } },
    });
  });

  it('filters by project only when a project is chosen, since its issues may live in another team', async () => {
    fetchMock.mockResolvedValue(reply(emptyIssues));

    await listLinearIssues('token', {
      linearProjectId: 'project-1',
      stateTypes: ['unstarted', 'started'],
      teamId: 'team-pkg',
    });

    expect(requestBody(fetchMock.mock.calls[0]).variables.filter).toEqual({
      project: { id: { eq: 'project-1' } },
      state: { type: { in: ['unstarted', 'started'] } },
    });
  });
  it('keeps the team and drops issues with a project when No project is chosen', async () => {
    fetchMock.mockResolvedValue(reply(emptyIssues));

    await countLinearIssues('token', {
      linearProjectId: LINEAR_NO_PROJECT_ID,
      stateTypes: ['backlog'],
      teamId: 'team-pkg',
    });

    expect(requestBody(fetchMock.mock.calls[0]).variables.filter).toEqual({
      project: { null: true },
      state: { type: { in: ['backlog'] } },
      team: { id: { eq: 'team-pkg' } },
    });
  });
});

describe('archived issues', () => {
  it('leaves archived issues out of the list and the count unless asked, as Linear does', async () => {
    fetchMock.mockImplementation(async () => reply(emptyIssues));
    const filter = { stateTypes: ['completed' as const], teamId: 'team-pkg' };

    await listLinearIssues('token', filter);
    await countLinearIssues('token', filter);
    await listLinearIssues('token', { ...filter, includeArchived: true });
    await countLinearIssues('token', { ...filter, includeArchived: true });

    const sent = fetchMock.mock.calls.map((call) => requestBody(call));
    for (const body of sent) {
      expect(body.query).toContain('includeArchived: $includeArchived');
    }
    expect(sent.map((body) => body.variables.includeArchived)).toEqual([false, false, true, true]);
  });

  it('looks picked and linked issues up by id whether archived or not', async () => {
    fetchMock.mockResolvedValue(
      reply({
        issues: {
          nodes: [{ id: 'archived-1' }],
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      }),
    );

    const issues = await getLinearIssuesByIds('token', ['archived-1']);

    expect(issues).toMatchObject([{ id: 'archived-1' }]);
    const body = requestBody(fetchMock.mock.calls[0]);
    expect(body.query).toContain('includeArchived: true');
    expect(body.variables.filter).toEqual({ id: { in: ['archived-1'] } });
  });
});

describe('getLinearProjectTeamIds', () => {
  it('reads every page of the teams a project belongs to', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          project: {
            teams: {
              nodes: [{ id: 'team-pkg' }, { id: 'team-lobe' }],
              pageInfo: { endCursor: 'cursor-1', hasNextPage: true },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        reply({
          project: {
            teams: {
              nodes: [{ id: 'team-ops' }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        }),
      );

    const ids = await getLinearProjectTeamIds('token', 'project-1');

    expect(ids).toEqual(['team-pkg', 'team-lobe', 'team-ops']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock.mock.calls[0]).variables).toMatchObject({
      projectId: 'project-1',
    });
    expect(requestBody(fetchMock.mock.calls[0]).variables.after).toBeUndefined();
    expect(requestBody(fetchMock.mock.calls[1]).variables).toMatchObject({
      after: 'cursor-1',
      projectId: 'project-1',
    });
  });

  it('returns no team for a project that does not exist', async () => {
    fetchMock.mockResolvedValue(reply({ project: null }));

    expect(await getLinearProjectTeamIds('token', 'gone')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('countLinearIssues', () => {
  const idPage = (count: number, endCursor: string | null) =>
    reply({
      issues: {
        nodes: Array.from({ length: count }, (_, index) => ({ id: `issue-${endCursor}-${index}` })),
        pageInfo: { endCursor, hasNextPage: endCursor !== null },
      },
    });

  it('adds up every page of ids with the picker filter', async () => {
    fetchMock.mockResolvedValueOnce(idPage(50, 'cursor-1')).mockResolvedValueOnce(idPage(12, null));

    const total = await countLinearIssues('token', {
      stateTypes: ['unstarted', 'started'],
      teamId: 'team-pkg',
    });

    expect(total).toEqual({ capped: false, count: 62 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = requestBody(fetchMock.mock.calls[0]);
    expect(first.query).toContain('nodes { id }');
    expect(first.variables).toEqual({
      filter: {
        state: { type: { in: ['unstarted', 'started'] } },
        team: { id: { eq: 'team-pkg' } },
      },
      first: 50,
      includeArchived: false,
    });
    expect(requestBody(fetchMock.mock.calls[1]).variables.after).toBe('cursor-1');
  });

  it('stops at the limit and reports the count as a lower bound', async () => {
    fetchMock
      .mockResolvedValueOnce(idPage(50, 'cursor-1'))
      .mockResolvedValueOnce(idPage(30, 'cursor-2'));

    const total = await countLinearIssues(
      'token',
      { stateTypes: ['started'], teamId: 'team-pkg' },
      80,
    );

    expect(total).toEqual({ capped: true, count: 80 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The last page asks only for what is left under the limit.
    expect(requestBody(fetchMock.mock.calls[1]).variables.first).toBe(30);
  });

  it('is exact when the last page ends right at the limit', async () => {
    fetchMock.mockResolvedValueOnce(idPage(50, null));

    expect(
      await countLinearIssues('token', { stateTypes: ['started'], teamId: 'team-pkg' }, 50),
    ).toEqual({ capped: false, count: 50 });
  });
});
