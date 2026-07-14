import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { SearchService } from '@/server/services/search';
import { getUserChannelPreferences } from '@/server/services/search/userChannels';

const searchProcedure = authedProcedure;

/**
 * Build a per-request search service seeded with the caller's ordered channel
 * preferences (search providers / crawler impls).
 *
 * The per-user preference read is optional: deployments (or local/dev mode)
 * with search/crawler env but no server database must keep web search usable.
 * `getServerDB()` throws when `KEY_VAULTS_SECRET` / `DATABASE_URL` are unset, so
 * we guard it here — a missing or failing database degrades to the server
 * default channel order rather than making the whole search path DB-required.
 */
const createUserSearchService = async (userId: string) => {
  let userChannels;
  try {
    const serverDB = await getServerDB();
    userChannels = await getUserChannelPreferences(serverDB, userId);
  } catch {
    // No server database configured — fall back to the server default order.
  }
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
      const searchService = await createUserSearchService(ctx.userId);
      return searchService.crawlPages(input);
    }),

  /**
   * Server-enabled search providers / crawler impls in env default order, so
   * the client can render a channel-ordering picker. This only reads env config
   * and never touches the database.
   */
  getAvailableChannels: searchProcedure.query(() => SearchService.getAvailableChannels()),

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
      const searchService = await createUserSearchService(ctx.userId);
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
      const searchService = await createUserSearchService(ctx.userId);
      return await searchService.webSearch(input);
    }),
});
