import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { canUseWorkspaceApiKeys } from '@/business/server/workspaceApiKey';
import { ApiKeyModel } from '@/database/models/apiKey';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const apiKeyProcedure = wsCompatProcedure
  .use(requireWorkspaceRoleWhenScoped('owner'))
  .use(serverDatabase)
  .use(async (opts) => {
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
        expiresAt: z.date().nullish(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId && !(await canUseWorkspaceApiKeys(ctx.workspaceId))) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Workspace API Key access is not available',
        });
      }

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
      const existing = await ctx.apiKeyModel.findById(input.id);
      if (!existing) return;
      assertWorkspaceRowManageable(ctx, existing.userId, 'API key');

      return ctx.apiKeyModel.delete(input.id);
    }),

  getApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:read'))
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findByKey(input.apiKey);
    }),

  getApiKeyById: apiKeyProcedure
    .use(withScopedPermission('api_key:read'))
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const apiKey = await ctx.apiKeyModel.findById(input.id);
      if (!apiKey) return apiKey;
      assertWorkspaceRowManageable(ctx, apiKey.userId, 'API key');

      return apiKey;
    }),

  getApiKeys: apiKeyProcedure.use(withScopedPermission('api_key:read')).query(async ({ ctx }) => {
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
          expiresAt: z.date().nullish(),
          name: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.apiKeyModel.findById(input.id);
      if (!existing) return;
      assertWorkspaceRowManageable(ctx, existing.userId, 'API key');

      return ctx.apiKeyModel.update(input.id, input.value);
    }),

  validateApiKey: apiKeyProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.validateKey(input.key);
    }),
});
