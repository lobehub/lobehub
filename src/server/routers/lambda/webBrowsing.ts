import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { WebBrowsingDocumentService } from '@/server/services/webBrowsing';

const webBrowsingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      webBrowsingService: new WebBrowsingDocumentService(ctx.serverDB, ctx.userId),
    },
  });
});

export const webBrowsingRouter = router({
  /**
   * Persist a crawled page as a `documents` row, deduping by URL and
   * short-circuiting on byte-identical content. See
   * `WebBrowsingDocumentService.upsertCrawledDocument` for the dispatch.
   */
  upsertCrawledDocument: webBrowsingProcedure
    .input(
      z.object({
        content: z.string(),
        description: z.string().optional(),
        title: z.string(),
        topicId: z.string().optional(),
        url: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.webBrowsingService.upsertCrawledDocument(input);
    }),
});
