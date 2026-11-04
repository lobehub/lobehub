import { getConnectorErrorMessage, isConnectorErrorRetryable } from '@lobechat/connector-data';
import type { CollectionError } from '@lobechat/types';

import type { ConnectorDataService } from '@/server/services/connectorData';

import type { CollectedUnderstandingProviderContext, UnderstandingProvider } from '../types';

const OPERATIONS = ['organization', 'teams', 'projects', 'issues'] as const;

const valueOf = <T>(result: PromiseSettledResult<T>) =>
  result.status === 'fulfilled' ? result.value : undefined;

/**
 * Collects the teams, active cycles, recent projects and recently updated issues
 * of a connected Linear workspace.
 *
 * Use when:
 * - A connected Linear account should describe how a team plans and tracks its work
 *
 * Expects:
 * - Connector Data has resolved a Market Linear connection for the caller
 * - `includePrivateTeams` only when whoever sees the result may see private teams;
 *   by default only public teams and their issues and projects are read
 *
 * Returns:
 * - A bounded source brief; each failed read is reported in diagnostics while the
 *   rest of the brief is still returned
 */
export const collectLinearUnderstanding = async ({
  connectorData,
  includePrivateTeams = false,
}: {
  connectorData: ConnectorDataService;
  includePrivateTeams?: boolean;
}): Promise<CollectedUnderstandingProviderContext> => {
  const client = await connectorData.getLinearClient();
  const scope = { publicTeamsOnly: !includePrivateTeams };
  const settled = await Promise.allSettled([
    client.getOrganization(),
    client.listTeams(scope),
    client.listRecentProjects(scope),
    client.listRecentIssues(scope),
  ]);
  const [organization, teams, projects, issues] = [
    valueOf(settled[0]),
    valueOf(settled[1]),
    valueOf(settled[2]),
    valueOf(settled[3]),
  ];
  const errors: CollectionError[] = settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            code: 'LINEAR_COLLECTION_FAILED',
            message: getConnectorErrorMessage(result.reason) ?? 'Linear collection failed',
            operation: OPERATIONS[index],
            provider: 'linear',
            retryable: isConnectorErrorRetryable(result.reason),
          },
        ]
      : [],
  );
  const evidenceCount = (teams?.length ?? 0) + (projects?.length ?? 0) + (issues?.length ?? 0);

  return {
    context: [
      'Provider: linear',
      '# Source Brief',
      'Linear evidence policy:',
      '- Teams, cycles and projects show how the workspace plans work; issue states and priorities are a snapshot, not commitments.',
      `- Issues are the most recently updated ones${includePrivateTeams ? '' : ' in public teams'}, not the full backlog; do not treat missing topics as absent.`,
      '- A team `memberCount` with `memberCountIsLowerBound: true` is a minimum; the team has more members.',
      '- Assignee and lead names identify who owns a piece of work; do not infer performance, seniority or anything personal from them.',
      JSON.stringify({ issues, organization, projects, provider: 'linear', teams }, null, 2),
    ].join('\n\n'),
    diagnostics: {
      errors,
      evidenceCount,
      failedCount: errors.length,
      succeededCount: settled.length - errors.length,
    },
    sourceCount: evidenceCount,
  };
};

/** Linear as an Understanding provider, reading public teams only. */
export const linearUnderstandingProvider: UnderstandingProvider = {
  connectionSource: 'lobehub',
  id: 'linear',
  collect: ({ connectorData }) => collectLinearUnderstanding({ connectorData }),
};
