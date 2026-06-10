import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ApiKeyModel } from '@/database/models/apiKey';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const apiKeyProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      apiKeyModel: new ApiKeyModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const apiKeyRouter = router({
  createApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:create'))
    .input(
      z.object({
        expiresAt: z.date().optional().nullable(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.apiKeyModel.create(input);
    }),

  deleteAllApiKeys: apiKeyProcedure
    .use(withScopedPermission('api_key:delete'))
    .mutation(async ({ ctx }) => {
      return ctx.apiKeyModel.deleteAll();
    }),

  deleteApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.apiKeyModel.delete(input.id);
    }),

  getApiKey: apiKeyProcedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findByKey(input.apiKey);
    }),

  getApiKeyById: apiKeyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findById(input.id);
    }),

  getApiKeys: apiKeyProcedure.query(async ({ ctx }) => {
    return ctx.apiKeyModel.query();
  }),

  updateApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:update'))
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().optional(),
          enabled: z.boolean().optional(),
          expiresAt: z.date().optional().nullable(),
          name: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.apiKeyModel.update(input.id, input.value);
    }),

  validateApiKey: apiKeyProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.validateKey(input.key);
    }),
});
