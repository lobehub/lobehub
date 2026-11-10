import { describe, expect, it, vi } from 'vitest';

import { createJiraConnectorClient } from './client';

const createClient = (execute: ReturnType<typeof vi.fn>) =>
  createJiraConnectorClient({
    composio: { tools: { execute } },
    connectedAccountId: 'ca_jira',
    toolVersion: '20261001_00',
    userId: 'owner',
  });

// Shapes recorded from a real Composio Jira connection (trimmed).
const projectsResult = {
  data: {
    data: {
      values: [
        {
          isPrivate: false,
          key: 'DP',
          lead: { displayName: 'Ada' },
          name: 'Donation Platform',
          projectTypeKey: 'software',
        },
        { isPrivate: true, key: 'HR', name: 'People Ops' },
        { key: 'LEGAL', name: 'Legal' },
        { name: 'No key' },
      ],
    },
  },
  successful: true,
};
const issuesResult = {
  data: {
    issues: [
      {
        assignee: {
          account_id: '7120',
          display_name: 'LobeHub bot',
          email_address: 'bot@example.com',
        },
        browser_url: 'https://acme.atlassian.net/browse/DP-14',
        issue_type: { name: 'Task' },
        key: 'DP-14',
        labels: ['release', 7],
        priority: { name: 'Medium' },
        project: { key: 'DP' },
        status: { category: 'To Do', name: 'To Do' },
        summary: 'Prepare Q4 giving-season release checklist',
        updated: '2026-10-17T19:13:55.361+0800',
      },
      { key: 'DP-1', summary: 'No link' },
    ],
  },
  successful: true,
};

describe('createJiraConnectorClient', () => {
  it('normalizes projects including their privacy', async () => {
    const execute = vi.fn(async () => projectsResult);

    await expect(createClient(execute).listProjects()).resolves.toEqual([
      {
        description: undefined,
        isPrivate: false,
        key: 'DP',
        lead: 'Ada',
        name: 'Donation Platform',
        type: 'software',
      },
      {
        description: undefined,
        isPrivate: true,
        key: 'HR',
        lead: undefined,
        name: 'People Ops',
        type: undefined,
      },
      // Jira did not say: treated as private so the default filter skips it.
      expect.objectContaining({ isPrivate: true, key: 'LEGAL' }),
    ]);
    expect(execute.mock.calls[0][1].arguments).toMatchObject({ expand: 'description,lead' });
  });

  it('searches recent issues in bounded JQL and never keeps emails', async () => {
    const execute = vi.fn(async () => issuesResult);

    const issues = await createClient(execute).listRecentIssues({
      projectKeys: ['DP', 'SAM1', 'bad key"'],
    });

    expect(execute.mock.calls[0][1].arguments.jql).toBe(
      'project in ("DP", "SAM1") ORDER BY updated DESC',
    );
    expect(issues).toEqual([
      {
        assignee: 'LobeHub bot',
        key: 'DP-14',
        labels: ['release'],
        priority: 'Medium',
        projectKey: 'DP',
        status: { category: 'To Do', name: 'To Do' },
        summary: 'Prepare Q4 giving-season release checklist',
        type: 'Task',
        updatedAt: '2026-10-17T19:13:55.361+0800',
        url: 'https://acme.atlassian.net/browse/DP-14',
      },
    ]);
    expect(JSON.stringify(issues)).not.toContain('bot@example.com');
  });

  it('skips the search when there is no project to scope it to', async () => {
    const execute = vi.fn();

    await expect(createClient(execute).listRecentIssues({ projectKeys: [] })).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
