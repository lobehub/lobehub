// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLinearProjectTeamIds, listLinearIssues } from '../issues';

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
