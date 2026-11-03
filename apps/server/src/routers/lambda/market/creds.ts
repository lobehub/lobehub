import type { UserCredSummary } from '@lobechat/types';
import { MarketAPIError, orgRefToPathSegment } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { withRbacPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { cloudWorkspaceAuth } from '@/business/server/trpc-middlewares/workspaceAuth';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, requireMarketAuth, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';

const log = debug('lambda-router:market:creds');

const MARKET_STATUS_TO_TRPC_CODE: Record<number, TRPCError['code']> = {
  400: 'BAD_REQUEST',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

/**
 * Maps a Market API error (share/publish/unshare return structured 400/403/404
 * responses — invalid org, not a member, credential/org not found) to the
 * matching tRPC error code so the frontend can distinguish them instead of
 * seeing a blanket 500.
 */
function mapMarketShareError(error: unknown, fallbackMessage: string): TRPCError {
  if (error instanceof MarketAPIError) {
    return new TRPCError({
      cause: error,
      code: MARKET_STATUS_TO_TRPC_CODE[error.status] ?? 'INTERNAL_SERVER_ERROR',
      message: error.message || fallbackMessage,
    });
  }
  return new TRPCError({ cause: error, code: 'INTERNAL_SERVER_ERROR', message: fallbackMessage });
}

// Creds procedure with market authentication
const credsProcedure = publicProcedure
  .use(serverDatabase)
  // `ctx.workspaceId` from the raw `X-Workspace-Id` header is NOT trustworthy on
  // its own (createLambdaContext copies it verbatim, with no membership check).
  // `cloudWorkspaceAuth` verifies the caller is actually a member before letting
  // `workspaceId` through — demoting it to `undefined` otherwise. `share`,
  // `publish` and `unshare` below target `ctx.workspaceId`; this guarantees
  // they can never reach a workspace the caller doesn't belong to.
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
 * The active workspace's organization, for share operations that act on one
 * of a credential's shares. Outside a workspace no org is sent, which Market
 * accepts while the credential has a single share.
 */
const shareTarget = (ctx: { workspaceId?: string | null }) =>
  ctx.workspaceId ? { orgId: orgRefToPathSegment({ workspaceId: ctx.workspaceId }) } : {};

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
        const result = await ctx.marketService.market.creds.createFile(input);
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
        values: z.record(z.string(), z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('createKV input: %O', { ...input, values: '[HIDDEN]' });

      try {
        const result = await ctx.marketService.market.creds.createKV(input);
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
        const result = await ctx.marketService.market.creds.createOAuth(input);
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
        const result = await ctx.marketService.market.creds.delete(input.id);
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
        const result = await ctx.marketService.market.creds.deleteByKey(input.key);
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
        const result = await ctx.marketService.market.creds.get(input.id, {
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
        const listResult = await ctx.marketService.market.creds.list();
        const cred = listResult.data?.find((c) => c.key === input.key);

        if (!cred) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Credential not found: ${input.key}`,
          });
        }

        // Then get the full credential with optional decryption
        const result = await ctx.marketService.market.creds.get(cred.id, {
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
        const result = await ctx.marketService.market.creds.getSkillCredStatus(
          input.skillIdentifier,
        );
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

  // Publish a privately shared credential so every member of the active
  // workspace can use it. Owner-only.
  publish: credsProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    log('publish input: id=%d', input.id);
    try {
      const result = await ctx.marketService.market.creds.publish(
        input.id,
        undefined,
        shareTarget(ctx),
      );
      log('publish success: id=%d', result.id);
      return result;
    } catch (error) {
      log('publish error: %O', error);
      throw mapMarketShareError(error, 'Failed to publish credential');
    }
  }),

  // Share one of the caller's own personal credentials into the current
  // workspace's Market organization. Always targets `ctx.workspaceId` — never
  // accepts an org id from client input — so `cloudWorkspaceAuth`'s membership
  // check (above) guarantees a caller can never share into a workspace they
  // don't belong to. A credential can be shared into several workspaces;
  // calling again for the same one changes that share's `visibility`.
  share: credsProcedure
    .input(
      z.object({
        id: z.number(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Sharing a credential requires an active workspace context',
        });
      }
      log('share input: id=%d, visibility=%s', input.id, input.visibility);
      try {
        const result = await ctx.marketService.market.creds.share(input.id, {
          orgId: orgRefToPathSegment({ workspaceId: ctx.workspaceId }),
          visibility: input.visibility,
        });
        log('share success: id=%d', result.id);
        return result;
      } catch (error) {
        log('share error: %O', error);
        throw mapMarketShareError(error, 'Failed to share credential');
      }
    }),

  // Remove a credential's share into the active workspace. Does not delete
  // the credential. Its owner, or an admin of that workspace, may call it.
  unshare: credsProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    log('unshare input: id=%d', input.id);
    try {
      const result = await ctx.marketService.market.creds.unshare(
        input.id,
        undefined,
        shareTarget(ctx),
      );
      log('unshare success: id=%d', result.id);
      return result;
    } catch (error) {
      log('unshare error: %O', error);
      throw mapMarketShareError(error, 'Failed to unshare credential');
    }
  }),

  // Inject credentials by keys (explicit injection).
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
  list: credsProcedure.query(async ({ ctx }): Promise<{ data?: UserCredSummary[] }> => {
    log('list called');

    try {
      const result = await ctx.marketService.market.creds.list();
      log('list success: %d credentials', result.data?.length ?? 0);

      if (!ctx.workspaceId) return result;

      const workspaceId = ctx.workspaceId;
      return {
        data: result.data?.map((cred) => ({
          ...cred,
          sharedToActiveWorkspace: !!cred.shares?.some(
            (share) => share.workspaceId === workspaceId,
          ),
        })),
      };
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
  /**
   * The credentials an agent run may inject, as the runtime's context rules
   * see them: inside a verified workspace the workspace's merged organization
   * view (org-owned creds + members' shared creds), otherwise the caller's
   * personal creds. Unlike `list`, this is scoped on purpose — it mirrors
   * `createServerContextFactProviders.listCredentials` so browser-mode and
   * server-mode runs read the same list.
   */
  listForContext: credsProcedure.query(async ({ ctx }) => {
    const result = ctx.workspaceId
      ? await ctx.marketService.market.organizations.creds({ workspaceId: ctx.workspaceId }).list()
      : await ctx.marketService.market.creds.list();
    const creds = (result.data ?? []) as Array<{
      description?: string;
      key: string;
      name: string;
      ownerDisplayName?: string;
      ownerType?: 'organization' | 'user';
      type: string;
    }>;
    log('listForContext success: %d credentials (workspace=%s)', creds.length, ctx.workspaceId);
    return {
      data: creds.map((cred) => ({
        description: cred.description,
        key: cred.key,
        name: cred.name,
        ownerDisplayName: cred.ownerDisplayName,
        ownerType: cred.ownerType,
        type: cred.type,
      })),
    };
  }),

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
        const result = await ctx.marketService.uploadCredFile(input);
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
        values: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      log('update input: id=%d, data=%O', id, {
        ...data,
        values: data.values ? '[HIDDEN]' : undefined,
      });

      try {
        const result = await ctx.marketService.market.creds.update(id, data);
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
