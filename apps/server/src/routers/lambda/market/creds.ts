import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { withRbacPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { cloudWorkspaceAuth } from '@/business/server/trpc-middlewares/workspaceAuth';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, requireMarketAuth, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';

const log = debug('lambda-router:market:creds');

// Creds procedure with market authentication
const credsProcedure = publicProcedure
  .use(serverDatabase)
  // `ctx.workspaceId` from the raw `X-Workspace-Id` header is NOT trustworthy on
  // its own (createLambdaContext copies it verbatim, with no membership check).
  // `cloudWorkspaceAuth` verifies the caller is actually a member before letting
  // `workspaceId` through — demoting it to `undefined` otherwise — so the
  // `credsAccessor` routing below can never be pointed at a workspace the
  // caller doesn't belong to. Must run before any procedure reads `ctx.workspaceId`.
  .use(cloudWorkspaceAuth)
  .use(marketUserInfo)
  .use(requireMarketAuth)
  .use(async ({ ctx, next }) => {
    return next({
      ctx: {
        marketService: new MarketService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
      },
    });
  });
const credsManageProcedure = credsProcedure.use(withRbacPermission('workspace:update:all'));

/**
 * Inside a workspace, reads/writes must hit the workspace's shared organization
 * credentials, never the operator's personal creds (LOBE-10978). `ctx.workspaceId`
 * is only ever set here once `cloudWorkspaceAuth` (above) has confirmed the
 * caller is a member of that workspace — never trust it directly off the raw
 * `X-Workspace-Id` header. Falls back to the personal `market.creds` namespace
 * outside a workspace.
 *
 * NOTE: unlike `workspaceCreds.ts`, writes routed through here do not (yet) emit
 * a `CloudWorkspaceAuditLogModel` entry — audit logging for this path is a
 * follow-up, tracked alongside LOBE-10978.
 */
const credsAccessor = (ctx: { marketService: MarketService; workspaceId?: string | null }) =>
  ctx.workspaceId
    ? ctx.marketService.market.organizations.creds({ workspaceId: ctx.workspaceId })
    : ctx.marketService.market.creds;

export const credsRouter = router({
  // Create file credential
  createFile: credsManageProcedure
    .input(
      z.object({
        description: z.string().optional(),
        fileHashId: z.string().length(64),
        fileName: z.string().min(1),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('createFile input: %O', { ...input, fileHashId: '[HIDDEN]' });

      try {
        const result = await credsAccessor(ctx).createFile(input);
        log('createFile success: id=%d', result.id);
        return result;
      } catch (error) {
        log('createFile error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create file credential',
        });
      }
    }),

  // Create KV credential (kv-env or kv-header)
  createKV: credsManageProcedure
    .input(
      z.object({
        description: z.string().optional(),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        type: z.enum(['kv-env', 'kv-header']),
        values: z.record(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('createKV input: %O', { ...input, values: '[HIDDEN]' });

      try {
        const result = await credsAccessor(ctx).createKV(input);
        log('createKV success: id=%d', result.id);
        return result;
      } catch (error) {
        log('createKV error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create KV credential',
        });
      }
    }),

  // Create OAuth credential
  createOAuth: credsManageProcedure
    .input(
      z.object({
        description: z.string().optional(),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        oauthConnectionId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('createOAuth input: %O', input);

      try {
        const result = await credsAccessor(ctx).createOAuth(input);
        log('createOAuth success: id=%d', result.id);
        return result;
      } catch (error) {
        log('createOAuth error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create OAuth credential',
        });
      }
    }),

  // Delete credential by ID
  delete: credsManageProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      log('delete input: %O', input);

      try {
        const result = await credsAccessor(ctx).delete(input.id);
        log('delete success');
        return result;
      } catch (error) {
        log('delete error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete credential',
        });
      }
    }),

  // Delete credential by key
  deleteByKey: credsManageProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      log('deleteByKey input: %O', input);

      try {
        const result = await credsAccessor(ctx).deleteByKey(input.key);
        log('deleteByKey success');
        return result;
      } catch (error) {
        log('deleteByKey error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete credential by key',
        });
      }
    }),

  // Get single credential (optionally with decrypted values)
  get: credsManageProcedure
    .input(
      z.object({
        decrypt: z.boolean().optional(),
        id: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      log('get input: %O', input);

      try {
        const result = await credsAccessor(ctx).get(input.id, {
          decrypt: input.decrypt,
        });
        log('get success: id=%d', input.id);
        return result;
      } catch (error) {
        log('get error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get credential',
        });
      }
    }),

  // Get single credential by key (optionally with decrypted values)
  getByKey: credsManageProcedure
    .input(
      z.object({
        decrypt: z.boolean().optional(),
        key: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      log('getByKey input: %O', input);

      try {
        // First find the credential by key from the list
        const listResult = await credsAccessor(ctx).list();
        const cred = listResult.data?.find((c) => c.key === input.key);

        if (!cred) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Credential not found: ${input.key}`,
          });
        }

        // Then get the full credential with optional decryption
        const result = await credsAccessor(ctx).get(cred.id, {
          decrypt: input.decrypt,
        });
        log('getByKey success: key=%s, id=%d', input.key, cred.id);
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        log('getByKey error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get credential by key',
        });
      }
    }),

  // Get skill credential status
  getSkillCredStatus: credsProcedure
    .input(z.object({ skillIdentifier: z.string() }))
    .query(async ({ ctx, input }) => {
      log('getSkillCredStatus input: %O', input);

      try {
        const result = await credsAccessor(ctx).getSkillCredStatus(input.skillIdentifier);
        log('getSkillCredStatus success: %d items', result.length);
        return result;
      } catch (error) {
        log('getSkillCredStatus error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get skill credential status',
        });
      }
    }),

  // Inject credentials by keys (explicit injection).
  // NOTE: intentionally NOT routed through `credsAccessor` — the Market SDK's
  // org-scoped creds service has no `inject` equivalent yet (LOBE-10978), so
  // this always resolves against the operator's personal credentials, even
  // inside a workspace.
  inject: credsProcedure
    .input(
      z.object({
        keys: z.array(z.string()),
        sandbox: z.boolean().optional().default(true),
        topicId: z.string(),
        userId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('inject input: %O', input);

      try {
        const userId = input.userId || ctx.userId;
        if (!userId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'userId is required for credential injection',
          });
        }

        const result = await ctx.marketService.market.creds.inject({
          keys: input.keys,
          sandbox: input.sandbox,
          topicId: input.topicId,
          userId,
        });
        log('inject success: %O', {
          notFound: result.notFound?.length,
          success: result.success,
        });
        return result;
      } catch (error) {
        log('inject error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to inject credentials',
        });
      }
    }),

  // Inject credentials for skill execution (auto-inject based on skill declaration).
  // NOTE: same Market SDK gap as `inject` above — stays personal-only for now.
  injectForSkill: credsProcedure
    .input(
      z.object({
        sandbox: z.boolean().optional().default(true),
        skillIdentifier: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('injectForSkill input: %O', input);

      try {
        // Note: SDK method is injectForSkill for skill-based injection
        const result = await (ctx.marketService.market.creds as any).injectForSkill(input);
        log('injectForSkill success: %O', {
          missing: result.missing?.length,
          success: result.success,
        });
        return result;
      } catch (error) {
        log('injectForSkill error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to inject credentials for skill',
        });
      }
    }),

  // List all credentials
  list: credsProcedure.query(async ({ ctx }) => {
    log('list called');

    try {
      const result = await credsAccessor(ctx).list();
      log('list success: %d credentials', result.data?.length ?? 0);
      return result;
    } catch (error) {
      log('list error: %O', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list credentials',
      });
    }
  }),

  // List OAuth connections (for creating OAuth credentials)
  listOAuthConnections: credsManageProcedure.query(async ({ ctx }) => {
    log('listOAuthConnections called');

    try {
      const result = await ctx.marketService.market.connect.listConnections();
      log('listOAuthConnections success: %d connections', result.connections?.length ?? 0);
      return result;
    } catch (error) {
      log('listOAuthConnections error: %O', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list OAuth connections',
      });
    }
  }),

  // Upload credential file
  uploadFile: credsManageProcedure
    .input(
      z.object({
        file: z.string(), // base64 encoded file content
        fileName: z.string().min(1),
        fileType: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('uploadFile input: fileName=%s, fileType=%s', input.fileName, input.fileType);

      try {
        const result = await ctx.marketService.uploadCredFile({
          ...input,
          orgId: ctx.workspaceId ? { workspaceId: ctx.workspaceId } : undefined,
        });
        log('uploadFile success: fileHashId=%s', result.fileHashId);
        return result;
      } catch (error) {
        log('uploadFile error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to upload file',
        });
      }
    }),

  // Update credential
  update: credsManageProcedure
    .input(
      z.object({
        description: z.string().optional(),
        id: z.number(),
        name: z.string().optional(),
        values: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      log('update input: id=%d, data=%O', id, {
        ...data,
        values: data.values ? '[HIDDEN]' : undefined,
      });

      try {
        const result = await credsAccessor(ctx).update(id, data);
        log('update success');
        return result;
      } catch (error) {
        log('update error: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update credential',
        });
      }
    }),
});
