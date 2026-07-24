import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { WebBrowsingDocumentService } from '@/server/services/webBrowsing';

const webBrowsingProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      webBrowsingService: new WebBrowsingDocumentService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
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
    // Writes a `documents` row — workspace viewers are read-only.
    .use(requireWorkspaceRoleWhenScoped('member'))
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
