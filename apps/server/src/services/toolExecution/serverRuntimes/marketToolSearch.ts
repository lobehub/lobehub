import type { MarketToolItem, SearchMarketToolsParams } from '@lobechat/builtin-tool-agent-builder';
import { hasCallableMcpEndpoint, isMarketplaceInstallCompleted } from '@lobechat/const';

import type { ConnectorModel } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';
import { ConnectorSourceType } from '@/database/schemas';
import type { DiscoverService } from '@/server/services/discover';

import type { ToolExecutionResult } from '../types';

/** Mirrors the "max: 20" advertised by every searchMarketTools manifest. */
export const MAX_MARKET_TOOLS_PAGE_SIZE = 20;

export interface MarketToolSearchDeps {
  connectorModel: Pick<ConnectorModel, 'queryByIdentifiers'>;
  discoverService: Pick<DiscoverService, 'getMcpList'>;
  pluginModel: Pick<PluginModel, 'query'>;
}

/** A marketplace connector whose install finished: the row `installPlugin` answers `exists` for. */
const isFinishedMarketplaceConnector = (connector: {
  mcpConnectionType?: string | null;
  mcpServerUrl?: string | null;
  metadata?: unknown;
  sourceType?: string | null;
}) =>
  connector.sourceType === ConnectorSourceType.marketplace &&
  hasCallableMcpEndpoint(connector) &&
  isMarketplaceInstallCompleted(connector.metadata);

/**
 * Server-side `searchMarketTools`, shared by Agent Builder and Agent Management.
 *
 * Each result is marked `installed` against the caller's installs, a finished
 * marketplace connector or a plugin row from before connectors, so the model
 * can skip a redundant install and go straight to pinning the id.
 */
export const searchMarketTools = async (
  { connectorModel, discoverService, pluginModel }: MarketToolSearchDeps,
  params: SearchMarketToolsParams,
): Promise<ToolExecutionResult> => {
  try {
    const pageSize = Math.min(Math.max(params.pageSize || 10, 1), MAX_MARKET_TOOLS_PAGE_SIZE);
    const [response, installedPlugins] = await Promise.all([
      discoverService.getMcpList({ category: params.category, pageSize, q: params.query }),
      pluginModel.query(),
    ]);
    const connectors = await connectorModel.queryByIdentifiers(
      response.items.map((item) => item.identifier),
    );
    const installedIds = new Set([
      ...installedPlugins.map((plugin) => plugin.identifier),
      ...connectors.filter(isFinishedMarketplaceConnector).map((connector) => connector.identifier),
    ]);

    const tools: MarketToolItem[] = response.items.map((item) => ({
      author: item.author,
      description: item.description,
      icon: item.icon,
      identifier: item.identifier,
      installed: installedIds.has(item.identifier),
      name: item.name,
      tags: item.tags,
    }));

    const summary = params.query
      ? `Found ${response.totalCount} tool(s) matching "${params.query}".`
      : `Found ${response.totalCount} tool(s) in the marketplace.`;

    const toolLines = tools
      .map(
        (t) =>
          `- ${t.name} (${t.identifier})${t.installed ? ' [installed]' : ''}${t.description ? ': ' + t.description : ''}`,
      )
      .join('\n');

    return {
      content: tools.length > 0 ? `${summary}\n\n${toolLines}` : summary,
      state: { query: params.query, tools, totalCount: response.totalCount },
      success: true,
    };
  } catch (error) {
    return {
      content: `Failed to search market tools: ${(error as Error).message}`,
      success: false,
    };
  }
};
