import { z } from 'zod';

import { SearchRepo } from '@/database/repositories/search';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DiscoverService } from '@/server/services/discover';

/**
 * Calculate relevance score for marketplace items
 * 1 = exact match, 2 = prefix match, 3 = contains match
 */
function calculateMarketplaceRelevance(query: string, title: string): number {
  const lowerQuery = query.toLowerCase().trim();
  const lowerTitle = title.toLowerCase();

  if (lowerTitle === lowerQuery) return 1;
  if (lowerTitle.startsWith(lowerQuery)) return 2;
  if (lowerTitle.includes(lowerQuery)) return 3;
  return 4;
}

const searchProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      discoverService: new DiscoverService({ accessToken: ctx.marketAccessToken }),
      searchRepo: new SearchRepo(ctx.serverDB, ctx.userId),
    },
  });
});

/**
 * The unified search router for all entities in the database.
 *
 * Can specify the type of entity to search for.
 */
export const searchRouter = router({
  query: searchProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limitPerType: z.number().optional(),
        locale: z.string().optional(),
        offset: z.number().optional(),
        query: z.string(),
        type: z
          .enum([
            'agent',
            'topic',
            'file',
            'folder',
            'message',
            'page',
            'mcp',
            'plugin',
            'communityAgent',
          ])
          .optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { query, type, limitPerType = 5, locale } = input;

      // Early return for empty query
      if (!query || query.trim() === '') return [];

      // Build search promises based on type filter
      const searchPromises: Promise<any>[] = [];

      // Database searches (agent, topic, file, folder, message, page)
      if (!type || ['agent', 'topic', 'file', 'folder', 'message', 'page'].includes(type)) {
        searchPromises.push(ctx.searchRepo.search(input));
      }

      // Marketplace searches (mcp, plugin)
      if (!type || type === 'mcp') {
        searchPromises.push(
          ctx.discoverService
            .getMcpList({
              locale,
              pageSize: limitPerType,
              q: query,
            })
            .then((response) =>
              response.items.slice(0, limitPerType).map((item: any) => ({
                author:
                  typeof item.author === 'string' ? item.author : item.author?.name || 'Unknown',
                avatar: item.avatar || item.icon || null,
                category: item.category || null,
                connectionType: item.connectionType || null,
                createdAt: new Date(item.createdAt || Date.now()),
                description: item.description || null,
                id: item.identifier,
                identifier: item.identifier,
                installCount: item.installCount || null,
                isFeatured: item.isFeatured || null,
                isValidated: item.isValidated || null,
                relevance: calculateMarketplaceRelevance(
                  query,
                  (item.name || item.title || item.identifier) as string,
                ),
                tags: item.tags || null,
                title: (item.name || item.title || item.identifier) as string,
                type: 'mcp' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch(() => []),
        );
      }

      if (!type || type === 'plugin') {
        searchPromises.push(
          ctx.discoverService
            .getPluginList({
              locale,
              pageSize: limitPerType,
              q: query,
            })
            .then((response) =>
              response.items.slice(0, limitPerType).map((item: any) => ({
                author:
                  typeof item.author === 'string' ? item.author : item.author?.name || 'Unknown',
                avatar: item.avatar || null,
                category: item.category || null,
                createdAt: new Date(item.createdAt || Date.now()),
                description: item.description || null,
                id: item.identifier,
                identifier: item.identifier,
                relevance: calculateMarketplaceRelevance(
                  query,
                  (item.title || item.identifier) as string,
                ),
                tags: item.tags || null,
                title: (item.title || item.identifier) as string,
                type: 'plugin' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch(() => []),
        );
      }

      if (!type || type === 'communityAgent') {
        searchPromises.push(
          ctx.discoverService
            .getAssistantList({
              includeAgentGroup: true,
              locale,
              pageSize: limitPerType,
              q: query,
            })
            .then((response) =>
              response.items.slice(0, limitPerType).map((item: any) => ({
                author:
                  typeof item.author === 'string' ? item.author : item.author?.name || 'Unknown',
                avatar: item.avatar || null,
                createdAt: new Date(item.createdAt || Date.now()),
                description: item.description || null,
                homepage: item.homepage || null,
                id: item.identifier,
                identifier: item.identifier,
                relevance: calculateMarketplaceRelevance(
                  query,
                  (item.title || item.identifier) as string,
                ),
                tags: item.tags || null,
                title: (item.title || item.identifier) as string,
                type: 'assistant' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch(() => []),
        );
      }

      // Execute searches in parallel and merge results
      const results = await Promise.all(searchPromises);
      const mergedResults = results.flat();

      // Sort by relevance and limit total results
      return mergedResults.sort((a, b) => {
        if (a.relevance !== b.relevance) return a.relevance - b.relevance;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }),
});
