import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';
import { resolveSandboxWorkspaceClaim } from '@/server/services/sandbox';
import { SandboxWorkspaceFilesError } from '@/server/services/sandbox/workspaceFiles';

/**
 * Browsing and managing the persistent sandbox workspace.
 *
 * The workspace lives on a volume mounted into the sandbox runtime, so every
 * call here runs inside a sandbox session on the caller's behalf. Paths are
 * always relative to the workspace root; the absolute mount path never reaches
 * a client, which leaves nothing for one to smuggle back.
 */

/** Relative workspace path, validated with the same rule the runtime applies. */
const relativePathSchema = z.string().refine(isSafeSandboxCwd, {
  message: 'Path must be a relative path inside the workspace',
});

/**
 * Topic whose warm sandbox session should serve the call, so listing a
 * directory does not cold-start a second sandbox next to the one the user is
 * already talking to.
 */
const topicIdSchema = z.string().min(1).max(255).optional();

const mapWorkspaceError = (error: unknown): never => {
  if (error instanceof SandboxWorkspaceFilesError) {
    const code =
      error.status === 404
        ? 'NOT_FOUND'
        : error.status === 403
          ? 'FORBIDDEN'
          : error.status === 400
            ? 'BAD_REQUEST'
            : 'BAD_GATEWAY';
    throw new TRPCError({ code, message: error.message });
  }

  throw error;
};

// The caller is always acting as themselves here — this is a signed-in user
// browsing their own workspace, not an agent run executing under someone
// else's identity — so there is no share-visitor case to suppress.
const workspaceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  const claim = await resolveSandboxWorkspaceClaim({
    isShareVisitorRun: false,
    serverDB: ctx.serverDB,
    userId: ctx.userId,
    workspaceId,
  });

  return opts.next({
    ctx: {
      claim,
      marketService: new MarketService({
        userInfo: { sandboxWorkspace: claim, userId: ctx.userId, workspaceId },
      }),
    },
  });
});

/**
 * Everything past the entitlement check. Without a claim there is no directory
 * to address — the execution plane would reject the call anyway, and failing
 * here keeps a client that renders the panel too eagerly from looking like a
 * server fault.
 */
const entitledProcedure = workspaceProcedure.use(async (opts) => {
  const { claim, marketService } = opts.ctx;
  if (!claim) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This account has no persistent sandbox workspace',
    });
  }

  return opts.next({ ctx: { claim, client: marketService.getSandboxWorkspaceClient() } });
});

export const sandboxWorkspaceRouter = router({
  /**
   * Whether this caller has a persistent workspace at all. The client pairs it
   * with the lab flag it already holds: flag off renders nothing, flag on
   * without an entitlement renders the upgrade prompt, and both renders the
   * workspace.
   */
  createDirectory: entitledProcedure
    .input(z.object({ path: relativePathSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => ctx.client.createDirectory(input).catch(mapWorkspaceError)),

  getEntitlement: workspaceProcedure.query(async ({ ctx }) => ({
    entitled: Boolean(ctx.claim),
    quotaBytes: ctx.claim?.quotaBytes ?? null,
  })),

  getWorkspace: entitledProcedure.query(async ({ ctx }) =>
    ctx.client.getWorkspace().catch(mapWorkspaceError),
  ),

  listFiles: entitledProcedure
    .input(
      z.object({
        path: relativePathSchema.optional(),
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => ctx.client.listFiles(input).catch(mapWorkspaceError)),

  readFile: entitledProcedure
    .input(z.object({ path: relativePathSchema, topicId: topicIdSchema }))
    .query(async ({ ctx, input }) => ctx.client.readFile(input).catch(mapWorkspaceError)),

  removeFile: entitledProcedure
    .input(
      z.object({
        path: relativePathSchema,
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.client.deleteFile(input).catch(mapWorkspaceError)),
});

export type SandboxWorkspaceRouter = typeof sandboxWorkspaceRouter;
