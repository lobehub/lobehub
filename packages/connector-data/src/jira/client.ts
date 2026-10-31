import { toRecord } from '@lobechat/utils/object';

import {
  type ComposioConnectorOptions,
  createComposioToolRunner,
  readComposioField,
} from '../composio';
import type { JiraConnectorClient, JiraIssue, JiraProject } from './types';

const LIST_PROJECTS_TOOL_SLUG = 'JIRA_GET_ALL_PROJECTS';
const SEARCH_ISSUES_TOOL_SLUG = 'JIRA_SEARCH_FOR_ISSUES_USING_JQL_POST';
const DEFAULT_PROJECTS = 30;
const DEFAULT_ISSUES = 40;
const MAX_PAGE_SIZE = 100;
const PROJECT_KEY = /^[A-Z]\w{0,19}$/i;
const ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'project',
  'labels',
  'issuetype',
  'updated',
];

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const list = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => toRecord(item)).filter((item) => !!item) : [];
const pageSize = (value: number | undefined, fallback: number) =>
  Math.min(Math.max(1, Math.trunc(Number.isFinite(value) ? value! : fallback)), MAX_PAGE_SIZE);
/** Reads a display name from either Jira's `displayName` or Composio's `display_name`. */
const displayName = (value: unknown) => {
  const record = toRecord(value);
  return str(record?.display_name) ?? str(record?.displayName);
};

/**
 * Creates a bounded, read-only Jira client over Composio tools.
 *
 * Use when:
 * - Onboarding analysis should read the Jira projects and recent issues an admin connected
 *
 * Expects:
 * - An ACTIVE Composio Jira connected account owned by `userId`
 *
 * Returns:
 * - A client that normalizes Composio's Jira payloads (snake_case issue fields,
 *   `browser_url`) and never keeps people's email addresses
 */
export const createJiraConnectorClient = (
  options: ComposioConnectorOptions,
): JiraConnectorClient => {
  const run = createComposioToolRunner('jira', options);

  return {
    listProjects: async ({ maxResults } = {}) => {
      const data = await run(LIST_PROJECTS_TOOL_SLUG, 'listProjects', {
        expand: 'description,lead',
        maxResults: pageSize(maxResults, DEFAULT_PROJECTS),
        orderBy: '-lastIssueUpdatedTime',
      });
      return list(readComposioField(data, 'values')).flatMap((project): JiraProject[] => {
        const key = str(project.key);
        const name = str(project.name);
        if (!key || !name) return [];
        return [
          {
            description: str(project.description),
            // Unknown privacy counts as private, so the default filter skips it.
            isPrivate: project.isPrivate !== false,
            key,
            lead: displayName(project.lead),
            name,
            type: str(project.projectTypeKey),
          },
        ];
      });
    },
    listRecentIssues: async ({ maxResults, projectKeys }) => {
      // JQL must be bounded, so the search is always scoped to known project keys.
      const keys = projectKeys.filter((key) => PROJECT_KEY.test(key));
      if (keys.length === 0) return [];
      const data = await run(SEARCH_ISSUES_TOOL_SLUG, 'listRecentIssues', {
        fields: ISSUE_FIELDS,
        jql: `project in (${keys.map((key) => `"${key}"`).join(', ')}) ORDER BY updated DESC`,
        maxResults: pageSize(maxResults, DEFAULT_ISSUES),
      });
      return list(readComposioField(data, 'issues')).flatMap((issue): JiraIssue[] => {
        const key = str(issue.key);
        const summary = str(issue.summary);
        const url = str(issue.browser_url);
        if (!key || !summary || !url) return [];
        const status = toRecord(issue.status);
        const statusName = str(status?.name);
        return [
          {
            assignee: displayName(issue.assignee),
            key,
            labels: Array.isArray(issue.labels)
              ? issue.labels.flatMap((label) => str(label) ?? [])
              : [],
            priority: str(toRecord(issue.priority)?.name),
            projectKey: str(toRecord(issue.project)?.key),
            status: statusName ? { category: str(status?.category), name: statusName } : undefined,
            summary,
            type: str(toRecord(issue.issue_type)?.name),
            updatedAt: str(issue.updated),
            url,
          },
        ];
      });
    },
  };
};
