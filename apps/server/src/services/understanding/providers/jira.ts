import { getConnectorErrorMessage, isConnectorErrorRetryable } from '@lobechat/connector-data';
import type { JiraIssue } from '@lobechat/connector-data/jira';
import type { CollectionError } from '@lobechat/types';

import type { ConnectorDataService } from '@/server/services/connectorData';

import type { CollectedUnderstandingProviderContext, UnderstandingProvider } from '../types';

const toError = (operation: string, reason: unknown): CollectionError => ({
  code: 'JIRA_COLLECTION_FAILED',
  message: getConnectorErrorMessage(reason) ?? 'Jira collection failed',
  operation,
  provider: 'jira',
  retryable: isConnectorErrorRetryable(reason),
});

/**
 * Collects the projects and recently updated issues of a connected Jira site.
 *
 * Use when:
 * - A connected Jira account should describe what a team works on and how it tracks work
 *
 * Expects:
 * - Connector Data has resolved a Composio Jira connection for the caller
 * - `includePrivateProjects` only when whoever sees the result may see private projects;
 *   by default private projects and their issues are skipped
 *
 * Returns:
 * - A bounded source brief; a failed issue search keeps the project list
 */
export const collectJiraUnderstanding = async ({
  connectorData,
  includePrivateProjects = false,
}: {
  connectorData: ConnectorDataService;
  includePrivateProjects?: boolean;
}): Promise<CollectedUnderstandingProviderContext> => {
  const client = await connectorData.getJiraClient();
  const projects = (await client.listProjects()).filter(
    (project) => includePrivateProjects || !project.isPrivate,
  );

  const errors: CollectionError[] = [];
  let issues: JiraIssue[] = [];
  try {
    issues = await client.listRecentIssues({ projectKeys: projects.map(({ key }) => key) });
  } catch (error) {
    errors.push(toError('issues', error));
  }
  const evidenceCount = projects.length + issues.length;

  return {
    context: [
      'Provider: jira',
      '# Source Brief',
      'Jira evidence policy:',
      '- Projects show what the team builds; issue statuses and priorities are a snapshot, not commitments.',
      `- Issues are the most recently updated ones${includePrivateProjects ? '' : ' in non-private projects'}, not the full backlog; do not treat missing topics as absent.`,
      '- Assignee and lead names identify who owns a piece of work; do not infer performance, seniority or anything personal from them.',
      JSON.stringify({ issues, projects, provider: 'jira' }, null, 2),
    ].join('\n\n'),
    diagnostics: {
      errors,
      evidenceCount,
      failedCount: errors.length,
      succeededCount: 2 - errors.length,
    },
    sourceCount: evidenceCount,
  };
};

/** Jira as an Understanding provider, skipping private projects. */
export const jiraUnderstandingProvider: UnderstandingProvider = {
  connectionSource: 'composio',
  id: 'jira',
  collect: ({ connectorData }) => collectJiraUnderstanding({ connectorData }),
};
