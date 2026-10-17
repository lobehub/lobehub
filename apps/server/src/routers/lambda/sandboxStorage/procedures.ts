import { TRPCError } from '@trpc/server';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';
import { resolveSandboxStorageClaim } from '@/server/services/sandbox';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';

/**
 * Statuses the execution plane uses deliberately, each carrying something the
 * user can act on. Anything else is a fault on the far side and says so.
 *
 * `409` is the one worth naming: it means a conversation is still using this
 * environment. Collapsing it into a generic upstream failure would replace the
 * only actionable message with one that suggests the product is broken.
 */
const WORKSPACE_ERROR_CODES: Record<number, TRPCError['code']> = {
  400: 'BAD_REQUEST',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  // The workspace is out of quota — the user frees space or upgrades.
  507: 'PAYLOAD_TOO_LARGE',
};

export const mapStorageError = (error: unknown): never => {
  if (error instanceof SandboxStorageFilesError) {
    throw new TRPCError({
      code: WORKSPACE_ERROR_CODES[error.status] ?? 'BAD_GATEWAY',
      // The machine code when the market sent one, the way this router's own
      // refusals travel (`ENVIRONMENT_HAS_INSTANCES`): the client turns a code
      // into a sentence in the reader's language. The description beside it
      // names the row by its id, so forwarding it verbatim put a UUID in a
      // toast — accurate, and useless to the person reading it.
      message: error.code || error.message,
    });
  }

  throw error;
};

/**
 * Resolves the caller's sandbox-storage claim: which directory on the volume
 * they are entitled to and how large it may be.
 *
 * It reads `ctx.workspaceId`, but that is the TEAM workspace, and it is read
 * only to decide whose storage this is — a member inside a team gets the
 * team's shared directory, otherwise their personal one. The claim itself has
 * nothing to do with the team workspace, which is why neither this nor
 * anything built on it is named after one.
 *
 * The caller is always acting as themselves here — a signed-in user browsing
 * their own storage, not an agent run executing under someone else's identity
 * — so there is no share-visitor case to suppress.
 */
export const storageClaimProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  const claim = await resolveSandboxStorageClaim({
    isShareVisitorRun: false,
    serverDB: ctx.serverDB,
    userId: ctx.userId,
    workspaceId,
  });

  return opts.next({
    ctx: {
      claim,
      marketService: new MarketService({
        userInfo: { sandboxStorage: claim, userId: ctx.userId, workspaceId },
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
export const entitledProcedure = storageClaimProcedure.use(async (opts) => {
  const { claim, marketService } = opts.ctx;
  if (!claim) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This account has no persistent sandbox workspace',
    });
  }

  return opts.next({ ctx: { claim, client: marketService.getSandboxStorageClient() } });
});

/**
 * An environment is a specification plus whatever has been built from it. This
 * layer owns the specification; the snapshot belongs to the execution plane and
 * is addressed by the row's id.
 *
 * An environment that was created but never used has no snapshot yet, which is
 * a normal state and not an error: it becomes real the first time a session
 * using it ends.
 */
export const environmentProcedure = entitledProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      environmentModel: new EnvironmentModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const instanceProcedure = environmentProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      instanceModel: new EnvironmentInstanceModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});
