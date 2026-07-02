import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { searchService } from '@/server/services/search';

const searchProcedure = authedProcedure;

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
