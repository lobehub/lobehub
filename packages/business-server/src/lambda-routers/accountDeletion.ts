import { z } from 'zod';

import { UserModel } from '@/database/models/user';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export const accountDeletionRouter = router({
  deleteCurrentUser: authedProcedure
    .use(serverDatabase)
    .input(z.object({ confirmation: z.literal('DELETE_MY_ACCOUNT') }))
    .mutation(async ({ ctx }) => {
      await UserModel.deleteUser(ctx.serverDB, ctx.userId);
      return { deleted: true };
    }),
});
