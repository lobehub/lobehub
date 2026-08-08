import { API_KEY_FULL_ACCESS_SCOPE, isValidApiKeyScope } from '@lobechat/const';
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

const apiKeyProcedure = wsCompatProcedure
  .use(requireWorkspaceRoleWhenScoped('admin'))
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
        // Scopes are set at creation time only (immutable afterwards).
        // `undefined`/`null` = full access; entries must come from the
        // catalog — unknown scope strings are rejected.
        scopes: z
          .array(z.string().refine(isValidApiKeyScope, { message: 'Unknown API key scope' }))
          .min(1)
          .nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId && !(await canUseWorkspaceApiKeys(ctx.workspaceId))) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Workspace API Key access is not available',
        });
      }

      // normalize: an explicit full-access selection stores exactly ['*']
      const scopes = input.scopes?.includes(API_KEY_FULL_ACCESS_SCOPE)
        ? [API_KEY_FULL_ACCESS_SCOPE]
        : input.scopes;

      return await ctx.apiKeyModel.create({ ...input, scopes });
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

      return ctx.apiKeyModel.update(input.id, input.value);
    }),

  validateApiKey: apiKeyProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.validateKey(input.key);
    }),
});
