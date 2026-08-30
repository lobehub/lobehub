import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { resolveMarketUserContext, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DiscoverService } from '@/server/services/discover';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

import { getRestrictedKnowledgeBaseIds } from './_helpers/knowledgeBaseAccess';

const MARKETPLACE_SEARCH_TYPES = new Set(['communityAgent', 'mcp', 'plugin']);

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

/**
 * Whether a query input reaches the marketplace at all. Untyped searches
 * include the marketplace by default (CLI and other callers rely on it);
 * latency-sensitive callers such as the command menu opt out with
 * `includeMarketplace: false` to keep the aggregate response DB-only.
 */
const wantsMarketplace = (input?: { includeMarketplace?: unknown; type?: unknown }) => {
  const type = typeof input?.type === 'string' ? input.type : undefined;
  if (type) return MARKETPLACE_SEARCH_TYPES.has(type);
  return input?.includeMarketplace !== false;
};

const searchProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const rawInput = (await opts.getRawInput()) as
    { includeMarketplace?: unknown; type?: unknown } | undefined;
  // Marketplace identity is only needed when the marketplace will be queried;
  // DB-only searches skip the extra auth round-trip.
  const marketContext = wantsMarketplace(rawInput)
    ? await resolveMarketUserContext(ctx)
    : { marketAccessToken: undefined, marketUserInfo: undefined };

  return opts.next({
    ctx: {
      discoverService: new DiscoverService({
        accessToken: marketContext.marketAccessToken ?? ctx.marketAccessToken,
        userInfo: marketContext.marketUserInfo,
      }),
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
        /**
         * Whether an untyped search also queries the marketplace (default
         * true). The command menu passes false: its aggregate response used to
         * gate on the slowest of three remote marketplace round-trips on every
         * keystroke. Ignored when `type` is set — an explicit marketplace type
         * always queries the marketplace, other types never do.
         */
        includeMarketplace: z.boolean().optional(),
        limitPerType: z.number().optional(),
        locale: z.string().optional(),
        offset: z.number().optional(),
        query: z.string(),
        type: z
          .enum([
            'agent',
            'chatGroup',
            'topic',
            'file',
            'folder',
            'message',
            'page',
            'memory',
            'mcp',
            'plugin',
            'communityAgent',
            'knowledgeBase',
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

      // Database searches (agent, topic, file, folder, message, page, memory)
      if (
        !type ||
        [
          'agent',
          'chatGroup',
          'topic',
          'file',
          'folder',
          'message',
          'page',
          'memory',
          'knowledgeBase',
        ].includes(type)
      ) {
        // Restricted (member No-access) KBs and their linked files/folders/
        // pages must not be discoverable through unified search either —
        // mirror the library-list filter. Only the KB-adjacent types consume
        // the exclusion, so other typed searches skip the extra lookups on
        // this debounced search-as-you-type path.
        const needsKbExclusion =
          !type || ['file', 'folder', 'knowledgeBase', 'page'].includes(type);
        const [excludeKnowledgeBaseIds, ftsSearchRepo] = await Promise.all([
          needsKbExclusion ? getRestrictedKnowledgeBaseIds(ctx) : [],
          createFtsSearchRepo({
            db: ctx.serverDB,
            userId: ctx.userId,
            workspaceId: ctx.workspaceId ?? undefined,
          }),
        ]);
        searchPromises.push(ftsSearchRepo.search({ ...input, excludeKnowledgeBaseIds }));
      }

      // Marketplace searches: see `includeMarketplace` on the input schema —
      // untyped searches include them by default, the command menu opts out.
      const marketplaceEnabled = wantsMarketplace(input);

      if (marketplaceEnabled && (!type || type === 'mcp')) {
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

      if (marketplaceEnabled && (!type || type === 'plugin')) {
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

      if (marketplaceEnabled && (!type || type === 'communityAgent')) {
        searchPromises.push(
          ctx.discoverService
            .getAssistantList(
              {
                includeAgentGroup: true,
                locale,
                pageSize: limitPerType,
                q: query,
              },
              { throwOnError: type === 'communityAgent' },
            )
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
                type: 'communityAgent' as const,
                updatedAt: new Date(item.updatedAt || Date.now()),
              })),
            )
            .catch((error) => {
              if (type !== 'communityAgent') return [];

              console.error('[search:communityAgent]', error);
              throw new TRPCError({
                cause: error,
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Marketplace agent search is currently unavailable',
              });
            }),
        );
      }

      // Execute searches in parallel and merge results
      const results = await Promise.all(searchPromises);

      // Results arrive pre-ordered per type (DB types from FtsSearchRepo with
      // topics/messages by recency, marketplace types from the discover service).
      // The command palette groups results by type, so we keep each source's order
      // instead of re-sorting the merged list by relevance.
      return results.flat();
    }),
});
