import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from '../errors';
import { createLinearMarketConnectorClient, LINEAR_QUERIES } from './marketClient';

const createClient = (proxyOAuthRequest: ReturnType<typeof vi.fn>) =>
  createLinearMarketConnectorClient({ market: { proxyOAuthRequest } });

const ok = (data: unknown) => ({ data: { data }, status: 200 });

/** @example The Market OAuth proxy provides bounded Linear team evidence. */
describe('createLinearMarketConnectorClient', () => {
  it('posts read-only GraphQL to the Linear proxy and clamps page sizes', async () => {
    const proxyOAuthRequest = vi.fn().mockResolvedValue(ok({ issues: { nodes: [] } }));

    await createClient(proxyOAuthRequest).listRecentIssues({ first: 500 });

    expect(proxyOAuthRequest).toHaveBeenCalledWith({
      body: { query: LINEAR_QUERIES.issues, variables: { filter: null, first: 50 } },
      endpoint: '/graphql',
      method: 'POST',
      provider: 'linear',
    });
  });

  it('filters every list to public teams when asked', async () => {
    const proxyOAuthRequest = vi
      .fn()
      .mockResolvedValue(
        ok({ issues: { nodes: [] }, projects: { nodes: [] }, teams: { nodes: [] } }),
      );
    const client = createClient(proxyOAuthRequest);
    const variables = () => proxyOAuthRequest.mock.lastCall![0].body.variables.filter;
    const publicTeam = { visibility: { eq: 'public' } };

    await client.listTeams({ publicTeamsOnly: true });
    expect(variables()).toEqual(publicTeam);
    await client.listRecentProjects({ publicTeamsOnly: true });
    expect(variables()).toEqual({ accessibleTeams: { every: publicTeam } });
    await client.listRecentIssues({ publicTeamsOnly: true });
    expect(variables()).toEqual({ team: publicTeam });
  });

  it('marks a member count cut at the page size as a lower bound', async () => {
    const proxyOAuthRequest = vi.fn().mockResolvedValueOnce(
      ok({
        teams: {
          nodes: [
            {
              key: 'ENG',
              members: { nodes: [{ id: 'u1' }], pageInfo: { hasNextPage: true } },
              name: 'Engineering',
            },
            {
              key: 'OPS',
              members: { nodes: [{ id: 'u2' }], pageInfo: { hasNextPage: false } },
              name: 'Operations',
            },
          ],
        },
      }),
    );

    const [eng, ops] = await createClient(proxyOAuthRequest).listTeams();
    expect(eng).toMatchObject({ memberCount: 1, memberCountIsLowerBound: true });
    expect(ops.memberCount).toBe(1);
    expect(ops.memberCountIsLowerBound).toBeUndefined();
    expect(LINEAR_QUERIES.teams).toContain('pageInfo { hasNextPage }');
  });

  it('normalizes teams, projects and issues and drops incomplete nodes', async () => {
    const proxyOAuthRequest = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          teams: {
            nodes: [
              {
                activeCycle: { name: null, number: 12, progress: 0.4, startsAt: '2026-10-12' },
                description: 'Core product',
                key: 'ENG',
                members: { nodes: [{ id: 'u1' }, { id: 'u2' }] },
                name: 'Engineering',
              },
              { key: null, name: 'Broken' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          projects: {
            nodes: [
              {
                lead: { displayName: 'ada' },
                name: 'Query engine v2',
                progress: 0.6,
                status: { name: 'In Progress', type: 'started' },
                teams: { nodes: [{ key: 'ENG' }] },
                url: 'https://linear.app/acme/project/query-engine-v2',
              },
              { name: 'No URL' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          issues: {
            nodes: [
              {
                assignee: null,
                identifier: 'ENG-42',
                labels: { nodes: [{ name: 'bug' }] },
                priorityLabel: 'High',
                project: { name: 'Query engine v2' },
                state: { name: 'In Review', type: 'started' },
                team: { key: 'ENG' },
                title: 'Fix cursor pagination',
                updatedAt: '2026-10-16T08:00:00.000Z',
                url: 'https://linear.app/acme/issue/ENG-42/fix-cursor-pagination',
              },
            ],
          },
        }),
      );
    const client = createClient(proxyOAuthRequest);

    await expect(client.listTeams()).resolves.toEqual([
      {
        activeCycle: {
          endsAt: undefined,
          name: undefined,
          number: 12,
          progress: 0.4,
          startsAt: '2026-10-12',
        },
        description: 'Core product',
        key: 'ENG',
        memberCount: 2,
        name: 'Engineering',
      },
    ]);
    await expect(client.listRecentProjects()).resolves.toEqual([
      expect.objectContaining({
        lead: 'ada',
        name: 'Query engine v2',
        status: { name: 'In Progress', type: 'started' },
        teamKeys: ['ENG'],
      }),
    ]);
    await expect(client.listRecentIssues()).resolves.toEqual([
      expect.objectContaining({
        assignee: undefined,
        identifier: 'ENG-42',
        labels: ['bug'],
        priority: 'High',
        state: { name: 'In Review', type: 'started' },
      }),
    ]);
  });

  it('surfaces GraphQL errors returned with HTTP 200 as non-retryable connector errors', async () => {
    const proxyOAuthRequest = vi.fn().mockResolvedValue({
      data: { errors: [{ message: 'Cannot query field "foo"' }] },
      status: 200,
    });

    const error = await createClient(proxyOAuthRequest)
      .getOrganization()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({
      code: 'linear_getOrganization_failed',
      message: 'Cannot query field "foo"',
      provider: 'linear',
      retryable: false,
    });
    expect(proxyOAuthRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps partial data when GraphQL reports an error for a nested node', async () => {
    const proxyOAuthRequest = vi.fn().mockResolvedValue({
      data: {
        data: {
          issues: {
            nodes: [
              {
                identifier: 'ENG-1',
                project: null,
                title: 'Ship',
                url: 'https://linear.app/a/issue/ENG-1',
              },
            ],
          },
        },
        errors: [{ message: 'Entity not found: Project', path: ['issues', 'nodes', 0, 'project'] }],
      },
      status: 200,
    });

    await expect(createClient(proxyOAuthRequest).listRecentIssues()).resolves.toEqual([
      expect.objectContaining({ identifier: 'ENG-1', project: undefined }),
    ]);
  });

  it('does not retry an unauthorized proxy response', async () => {
    const proxyOAuthRequest = vi.fn().mockResolvedValue({ data: {}, status: 401 });

    await expect(createClient(proxyOAuthRequest).listTeams()).rejects.toMatchObject({
      message: 'Linear listTeams failed (HTTP 401)',
      retryable: false,
    });
    expect(proxyOAuthRequest).toHaveBeenCalledTimes(1);
  });
});
