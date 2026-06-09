import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { FileS3 } from '@/server/modules/S3';

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      return await s3.createPreSignedUrl(input.pathname);
    }),
});

export type FileRouter = typeof uploadRouter;
