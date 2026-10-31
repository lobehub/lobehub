import type { MarketToolItem, SearchMarketToolsParams } from '@lobechat/builtin-tool-agent-builder';

import type { PluginModel } from '@/database/models/plugin';
import type { DiscoverService } from '@/server/services/discover';

import type { ToolExecutionResult } from '../types';

/** Mirrors the "max: 20" advertised by every searchMarketTools manifest. */
export const MAX_MARKET_TOOLS_PAGE_SIZE = 20;

export interface MarketToolSearchDeps {
  discoverService: Pick<DiscoverService, 'getMcpList'>;
  pluginModel: Pick<PluginModel, 'query'>;
}

/**
 * Server-side `searchMarketTools`, shared by Agent Builder and Agent Management.
 *
 * Each result is marked `installed` against the caller's installed plugins so
 * the model can skip a redundant install and go straight to pinning the id.
 */
export const searchMarketTools = async (
  { discoverService, pluginModel }: MarketToolSearchDeps,
  params: SearchMarketToolsParams,
): Promise<ToolExecutionResult> => {
  try {
    const pageSize = Math.min(Math.max(params.pageSize || 10, 1), MAX_MARKET_TOOLS_PAGE_SIZE);
    const [response, installedPlugins] = await Promise.all([
      discoverService.getMcpList({ category: params.category, pageSize, q: params.query }),
      pluginModel.query(),
    ]);
    const installedIds = new Set(installedPlugins.map((plugin) => plugin.identifier));

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
