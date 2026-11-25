import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { getLinkPreview, MAX_LINK_PREVIEW_URL_LENGTH } from '@/server/services/linkPreview';

export const linkPreviewRouter = router({
  /** The Open Graph card of a public page a message links, or `null` when it has none. */
  get: authedProcedure
    .input(z.object({ url: z.string().max(MAX_LINK_PREVIEW_URL_LENGTH) }))
    .query(({ input }) => getLinkPreview(input.url)),
});
