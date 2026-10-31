import { ConnectorDataError } from '@lobechat/connector-data';
import { describe, expect, it, vi } from 'vitest';

import { collectJiraUnderstanding, jiraUnderstandingProvider } from './jira';

const projects = [
  { isPrivate: false, key: 'DP', name: 'Donation Platform' },
  { isPrivate: true, key: 'HR', name: 'People Ops' },
];
const issue = {
  key: 'DP-7',
  labels: [],
  summary: 'Recurring donations',
  url: 'https://acme.atlassian.net/browse/DP-7',
};

const connectorDataFor = (client: Record<string, unknown>) =>
  ({ getJiraClient: vi.fn(async () => client) }) as never;

/** @example Jira projects and issues describe what a team builds. */
describe('jiraUnderstandingProvider', () => {
  it('skips private projects and their issues by default', async () => {
    const client = {
      listProjects: vi.fn(async () => projects),
      listRecentIssues: vi.fn(async () => [issue]),
    };

    const result = await jiraUnderstandingProvider.collect({
      connectorData: connectorDataFor(client),
      userId: 'user-1',
    });

    expect(client.listRecentIssues).toHaveBeenCalledWith({ projectKeys: ['DP'] });
    expect(result.context).not.toContain('People Ops');
    expect(result.context).toContain(issue.url);
    expect(result.sourceCount).toBe(2);
  });

  it('reads private projects when allowed and keeps projects when the issue search fails', async () => {
    const client = {
      listProjects: vi.fn(async () => projects),
      listRecentIssues: vi.fn(async () => {
        throw new ConnectorDataError({
          code: 'jira_listRecentIssues_failed',
          message: 'Rate limited',
          operation: 'listRecentIssues',
          provider: 'jira',
          retryable: true,
        });
      }),
    };

    const result = await collectJiraUnderstanding({
      connectorData: connectorDataFor(client),
      includePrivateProjects: true,
    });

    expect(client.listRecentIssues).toHaveBeenCalledWith({ projectKeys: ['DP', 'HR'] });
    expect(result.context).toContain('People Ops');
    expect(result.diagnostics).toMatchObject({
      errors: [{ message: 'Rate limited', operation: 'issues', provider: 'jira', retryable: true }],
      failedCount: 1,
      succeededCount: 1,
    });
  });
});
