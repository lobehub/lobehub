import { ConnectorDataError } from '@lobechat/connector-data';
import { describe, expect, it, vi } from 'vitest';

import { collectLinearUnderstanding, linearUnderstandingProvider } from './linear';

const issue = {
  identifier: 'ENG-42',
  labels: ['bug'],
  title: 'Fix cursor pagination',
  url: 'https://linear.app/acme/issue/ENG-42/fix-cursor-pagination',
};

const collect = (client: Record<string, unknown>) =>
  linearUnderstandingProvider.collect({
    connectorData: { getLinearClient: vi.fn(async () => client) } as never,
    userId: 'user-1',
  });

/** @example Linear planning data describes how a team tracks its work. */
describe('linearUnderstandingProvider', () => {
  it('collects teams, projects and issues with their URLs into one brief', async () => {
    const result = await collect({
      getOrganization: vi.fn(async () => ({ name: 'Acme', urlKey: 'acme' })),
      listRecentIssues: vi.fn(async () => [issue]),
      listRecentProjects: vi.fn(async () => [
        { name: 'Query engine v2', teamKeys: ['ENG'], url: 'https://linear.app/acme/project/q' },
      ]),
      listTeams: vi.fn(async () => [{ key: 'ENG', name: 'Engineering' }]),
    });

    expect(result.context).toContain('Provider: linear');
    expect(result.context).toContain(issue.url);
    expect(result.sourceCount).toBe(3);
    expect(result.diagnostics).toEqual({
      errors: [],
      evidenceCount: 3,
      failedCount: 0,
      succeededCount: 4,
    });
  });

  it('keeps the readable parts when one read fails', async () => {
    const result = await collect({
      getOrganization: vi.fn(async () => ({ name: 'Acme' })),
      listRecentIssues: vi.fn(async () => [issue]),
      listRecentProjects: vi.fn(async () => {
        throw new ConnectorDataError({
          code: 'linear_listRecentProjects_failed',
          message: 'Rate limited',
          operation: 'listRecentProjects',
          provider: 'linear',
          retryable: true,
        });
      }),
      listTeams: vi.fn(async () => []),
    });

    expect(result.context).toContain('ENG-42');
    expect(result.diagnostics).toMatchObject({
      errors: [
        {
          message: 'Rate limited',
          operation: 'projects',
          provider: 'linear',
          retryable: true,
        },
      ],
      failedCount: 1,
      succeededCount: 3,
    });
  });

  it('reads public teams only unless private teams are allowed', async () => {
    const client = {
      getOrganization: vi.fn(async () => ({ name: 'Acme' })),
      listRecentIssues: vi.fn(async () => []),
      listRecentProjects: vi.fn(async () => []),
      listTeams: vi.fn(async () => []),
    };
    const connectorData = { getLinearClient: vi.fn(async () => client) } as never;

    const byDefault = await linearUnderstandingProvider.collect({
      connectorData,
      userId: 'user-1',
    });
    for (const list of [client.listTeams, client.listRecentProjects, client.listRecentIssues]) {
      expect(list).toHaveBeenLastCalledWith({ publicTeamsOnly: true });
    }
    expect(byDefault.context).toContain('in public teams');

    const withPrivate = await collectLinearUnderstanding({
      connectorData,
      includePrivateTeams: true,
    });
    for (const list of [client.listTeams, client.listRecentProjects, client.listRecentIssues]) {
      expect(list).toHaveBeenLastCalledWith({ publicTeamsOnly: false });
    }
    expect(withPrivate.context).not.toContain('in public teams');
  });
});
