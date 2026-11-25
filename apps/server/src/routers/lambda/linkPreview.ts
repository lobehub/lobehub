import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { getLinkPreview, MAX_LINK_PREVIEW_URL_LENGTH } from '@/server/services/linkPreview';
import {
  LinkPreviewRateLimitedError,
  LinkPreviewUnavailableError,
} from '@/server/services/linkPreview/errors';

export const linkPreviewRouter = router({
  /**
   * The Open Graph card of a public page a message links, or `null` when it has
   * none. `BAD_GATEWAY` when the page could not be read just now and
   * `TOO_MANY_REQUESTS` once the user's page-read budget is spent: either way
   * the viewer keeps whatever card it already has.
   */
  get: authedProcedure
    .input(z.object({ url: z.string().max(MAX_LINK_PREVIEW_URL_LENGTH) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getLinkPreview(input.url, ctx.userId);
      } catch (error) {
        if (error instanceof LinkPreviewRateLimitedError) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: error.message });
        }
        if (error instanceof LinkPreviewUnavailableError) {
          throw new TRPCError({ cause: error, code: 'BAD_GATEWAY', message: error.message });
        }
        throw error;
      }
    }),
});
