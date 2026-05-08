import { asyncRouter as router, publicProcedure } from '@/libs/trpc/async';

import { documentRouter } from './document';
import { fileRouter } from './file';
import { imageRouter } from './image';
import { ragEvalRouter } from './ragEval';
import { videoRouter } from './video';

export const asyncRouter = router({
  document: documentRouter,
  file: fileRouter,
  healthcheck: publicProcedure.query(() => "i'm live!"),
  image: imageRouter,
  ragEval: ragEvalRouter,
  video: videoRouter,
});

export type AsyncRouter = typeof asyncRouter;

export type { UnifiedAsyncCaller } from './caller';
export { createAsyncCaller, createAsyncServerClient } from './caller';
