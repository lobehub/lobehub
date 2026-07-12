import type { LobeChatDatabase } from '@lobechat/database';
import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { SearchService } from '@/server/services/search';
import { getUserWebBrowsingConfig } from '@/server/services/search/userChannels';

// This surface executes external search/crawl providers and spends server-side
// search quota — unlike the lambda `search` namespace (app content search),
// which shares the same `search.*` paths, so the generic path-based guard
// cannot tell them apart. Gate it here: restricted keys need `model:invoke`.
const requireModelInvokeForRestrictedKeys = trpc.middleware(async ({ ctx, next }) => {
  const scopes = (ctx as { apiKeyScopes?: string[] | null }).apiKeyScopes;

  if (
    scopes !== undefined &&
    !isFullAccessApiKey(scopes) &&
    !hasApiKeyScope(scopes, 'model:invoke')
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "This API key cannot use external search: missing required scope 'model:invoke'.",
    });
  }

  return next();
});

const searchProcedure = authedProcedure
  .use(requireModelInvokeForRestrictedKeys)
  .use(serverDatabase);

/**
 * Build a per-request search service seeded with the caller's ordered channel
 * preferences (search providers / crawler impls). Reading preferences degrades
 * to the server default order on failure, so it never blocks the actual query.
 */
const createUserSearchService = async (ctx: { serverDB: LobeChatDatabase; userId: string }) => {
  const userChannels = await getUserWebBrowsingConfig(ctx.serverDB, ctx.userId);
  return new SearchService({ userChannels });
};

export const searchRouter = router({
  crawlPages: searchProcedure
    .input(
      z.object({
        impls: z
          .enum(['browserless', 'exa', 'firecrawl', 'jina', 'naive', 'search1api', 'tavily'])
          .array()
          .optional(),
        urls: z.string().array(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const searchService = await createUserSearchService(ctx);
      return searchService.crawlPages(input);
    }),

  /**
   * Server-enabled search providers / crawler impls in env default order, so
   * the client can render a channel-ordering picker. This only reads env config,
   * so it skips the `serverDatabase` middleware the other procedures need.
   */
  getAvailableChannels: authedProcedure.query(() => SearchService.getAvailableChannels()),

  query: searchProcedure
    .input(
      z.object({
        optionalParams: z
          .object({
            searchCategories: z.array(z.string()).optional(),
            searchEngines: z.array(z.string()).optional(),
            searchTimeRange: z.string().optional(),
          })
          .optional(),
        query: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const searchService = await createUserSearchService(ctx);
      return await searchService.query(input.query, input.optionalParams);
    }),

  webSearch: searchProcedure
    .input(
      z.object({
        query: z.string(),
        searchCategories: z.array(z.string()).optional(),
        searchEngines: z.array(z.string()).optional(),
        searchTimeRange: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const searchService = await createUserSearchService(ctx);
      return await searchService.webSearch(input);
    }),
});
