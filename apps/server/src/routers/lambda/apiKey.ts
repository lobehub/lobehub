import { API_KEY_FULL_ACCESS_SCOPE, isValidApiKeyScope } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  type WorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { canUseWorkspaceApiKeys } from '@/business/server/workspaceApiKey';
import { ApiKeyModel } from '@/database/models/apiKey';
import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const apiKeyScopesSchema = z
  .array(z.string().refine(isValidApiKeyScope, { message: 'Unknown API key scope' }))
  .min(1)
  .nullish();

const normalizeScopes = (scopes: string[] | null | undefined) =>
  scopes?.includes(API_KEY_FULL_ACCESS_SCOPE) ? [API_KEY_FULL_ACCESS_SCOPE] : scopes;

/**
 * Reads `workspaceRole` as an optional context field: the cloud workspace-auth
 * override injects it, while the OSS stub leaves it absent. Same shape as
 * `_helpers/assertWorkspaceRowManageable`, keeping this router build-portable.
 */
const isWorkspaceAdmin = (ctx: { userId: string; workspaceRole?: WorkspaceRole }) =>
  ctx.workspaceRole === 'owner' || ctx.workspaceRole === 'admin';

const apiKeyProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      apiKeyModel: new ApiKeyModel(ctx.serverDB, ctx.userId, wsId, {
        canManageAll: isWorkspaceAdmin(ctx),
      }),
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

const recordApiKeyAudit = async (
  ctx: {
    clientIp?: string | null;
    serverDB: ConstructorParameters<typeof WorkspaceAuditLogModel>[0];
    userId: string;
    workspaceId?: string | null;
  },
  params: {
    action: 'api_key.created' | 'api_key.revoked' | 'api_key.updated';
    metadata?: Record<string, unknown>;
    resourceId: string;
  },
) => {
  if (!ctx.workspaceId) return;

  await new WorkspaceAuditLogModel(ctx.serverDB).create({
    action: params.action,
    ipAddress: ctx.clientIp ?? undefined,
    metadata: params.metadata,
    resourceId: params.resourceId,
    resourceType: 'api_key',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

export const apiKeyRouter = router({
  createApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:create'))
    .input(
      z.object({
        expiresAt: z.date().nullish(),
        name: z.string(),
        // `undefined`/`null` = full access; entries must come from the
        // catalog — unknown scope strings are rejected.
        scopes: apiKeyScopesSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        if (!(await canUseWorkspaceApiKeys(ctx.workspaceId))) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Workspace API Key access is not available',
          });
        }

        const memberCreation = await ctx.workspaceModel.getApiKeyMemberCreation(ctx.workspaceId);
        if (memberCreation === 'admins_only' && !isWorkspaceAdmin(ctx)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Workspace API Key creation is restricted to admins',
          });
        }
      }

      const scopes = normalizeScopes(input.scopes);
      const result = await ctx.apiKeyModel.create({ ...input, scopes });
      await recordApiKeyAudit(ctx, {
        action: 'api_key.created',
        metadata: { expiresAt: result.expiresAt, name: result.name, scopes: result.scopes ?? null },
        resourceId: result.id,
      });

      return result;
    }),

  deleteAllApiKeys: apiKeyProcedure
    .use(withScopedPermission('api_key:delete'))
    .mutation(async ({ ctx }) => {
      const deleted = await ctx.apiKeyModel.deleteAll();
      await Promise.all(
        deleted.map((item) =>
          recordApiKeyAudit(ctx, {
            action: 'api_key.revoked',
            metadata: { name: item.name, scopes: item.scopes ?? null },
            resourceId: item.id,
          }),
        ),
      );
      return deleted;
    }),

  deleteApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.apiKeyModel.findById(input.id);
      if (!existing) return;

      const result = await ctx.apiKeyModel.delete(input.id);
      await recordApiKeyAudit(ctx, {
        action: 'api_key.revoked',
        metadata: { name: existing.name, scopes: existing.scopes ?? null },
        resourceId: existing.id,
      });
      return result;
    }),

  getApiKey: apiKeyProcedure
    .use(withScopedPermission('api_key:read'))
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const apiKey = await ctx.apiKeyModel.findByKey(input.apiKey);
      if (!apiKey) return apiKey;
      const { key: _, keyHash: __, ...safeApiKey } = apiKey;
      return safeApiKey;
    }),

  getApiKeyById: apiKeyProcedure
    .use(withScopedPermission('api_key:read'))
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const apiKey = await ctx.apiKeyModel.findById(input.id);
      if (!apiKey) return apiKey;

      const { key: _, keyHash: __, ...safeApiKey } = apiKey;
      return safeApiKey;
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
          enabled: z.boolean().optional(),
          expiresAt: z.date().nullish(),
          name: z.string().optional(),
          scopes: apiKeyScopesSchema,
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.apiKeyModel.findById(input.id);
      if (!existing) return;
      if (existing.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the API Key creator can edit this key',
        });
      }

      const nextValue = {
        ...input.value,
        scopes: input.value.scopes === undefined ? undefined : normalizeScopes(input.value.scopes),
      };
      const result = await ctx.apiKeyModel.update(input.id, nextValue);
      await recordApiKeyAudit(ctx, {
        action: 'api_key.updated',
        metadata: {
          after: {
            enabled: nextValue.enabled ?? existing.enabled,
            expiresAt: nextValue.expiresAt === undefined ? existing.expiresAt : nextValue.expiresAt,
            name: nextValue.name ?? existing.name,
            scopes: nextValue.scopes === undefined ? (existing.scopes ?? null) : nextValue.scopes,
          },
          before: {
            enabled: existing.enabled,
            expiresAt: existing.expiresAt,
            name: existing.name,
            scopes: existing.scopes ?? null,
          },
        },
        resourceId: existing.id,
      });

      return result;
    }),

  validateApiKey: apiKeyProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.validateKey(input.key);
    }),
});
