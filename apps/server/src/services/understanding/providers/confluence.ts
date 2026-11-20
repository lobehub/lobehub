import type { ConnectorDataService } from '@/server/services/connectorData';

import type { CollectedUnderstandingProviderContext, UnderstandingProvider } from '../types';

/**
 * Collects the recently modified pages of a connected Confluence site.
 *
 * Use when:
 * - A connected Confluence account should describe a team's projects, processes and docs
 *
 * Expects:
 * - Connector Data has resolved a Composio Confluence connection for the caller
 * - `includePersonalSpaces` only when whoever sees the result may see members' personal
 *   spaces; by default only pages in shared spaces are kept
 *
 * Returns:
 * - A bounded source brief of page titles, links and plain-text excerpts
 */
export const collectConfluenceUnderstanding = async ({
  connectorData,
  includePersonalSpaces = false,
}: {
  connectorData: ConnectorDataService;
  includePersonalSpaces?: boolean;
}): Promise<CollectedUnderstandingProviderContext> => {
  const client = await connectorData.getConfluenceClient();
  const pages = (await client.listRecentPages()).filter(
    (page) => includePersonalSpaces || !page.isPersonalSpace,
  );

  return {
    context: [
      'Provider: confluence',
      '# Source Brief',
      'Confluence evidence policy:',
      '- Pages describe the team’s projects, processes and decisions; template and sample pages carry no team-specific facts.',
      `- Pages are the most recently modified ones${includePersonalSpaces ? '' : ' in shared spaces'}, with excerpts only; do not treat missing topics as absent.`,
      JSON.stringify({ pages, provider: 'confluence' }, null, 2),
    ].join('\n\n'),
    diagnostics: {
      errors: [],
      evidenceCount: pages.length,
      failedCount: 0,
      succeededCount: 1,
    },
    sourceCount: pages.length,
  };
};

/** Confluence as an Understanding provider, skipping personal spaces. */
export const confluenceUnderstandingProvider: UnderstandingProvider = {
  connectionSource: 'composio',
  id: 'confluence',
  collect: ({ connectorData }) => collectConfluenceUnderstanding({ connectorData }),
};
