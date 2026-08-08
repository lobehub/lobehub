import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';
import { searchService } from '@/server/services/search';

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

const searchProcedure = authedProcedure.use(requireModelInvokeForRestrictedKeys);

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
    .mutation(async ({ input }) => {
      return searchService.crawlPages(input);
    }),

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
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
      return await searchService.webSearch(input);
    }),
});
