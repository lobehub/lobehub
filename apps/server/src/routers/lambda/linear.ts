import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { LinearConnectionModel } from '@/database/models/linear';
import { linearEnv } from '@/envs/linear';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { LINEAR_INSTALL_PATH, revokeLinearToken } from '@/server/services/linear/client';
import { canWriteScmScope } from '@/server/services/scm/scope';

const linearProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { scope: { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null } },
  });
});

const connectionInput = z.object({ connectionId: z.string().uuid() });

/**
 * The Linear integration for the settings page. Connecting happens through
 * the OAuth redirect (`/api/webhooks/linear/install`); listing and
 * disconnecting comes through here, scoped to the connections visible in
 * the caller's scope.
 */
export const linearRouter = router({
  /** Remove the connection: revoke the token at Linear and hide the row. */
  disconnect: linearProcedure.input(connectionInput).mutation(async ({ ctx, input }) => {
    const connection = await requireWritableConnection(ctx, input.connectionId);

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const decrypted = await LinearConnectionModel.findDecryptedById(
      ctx.serverDB,
      connection.id,
      gateKeeper,
    );
    if (decrypted?.credentials) {
      await revokeLinearToken(decrypted.credentials, decrypted.tokenExpiresAt);
    }

    await LinearConnectionModel.revoke(ctx.serverDB, connection.id);
    return { ok: true };
  }),

  /** What the client needs to render the connect button. */
  getConfig: linearProcedure.query(async () => ({
    enabled: linearEnv.ENABLED_LINEAR,
    installPath: LINEAR_INSTALL_PATH,
  })),

  listConnections: linearProcedure.query(async ({ ctx }) => {
    const rows = await LinearConnectionModel.listByScope(ctx.serverDB, ctx.scope);
    return rows.map((row) => LinearConnectionModel.toView(row));
  }),
});

/**
 * The connection, if it is active and visible in the caller's scope and the
 * caller may write there (in a workspace that takes a member role).
 */
const requireWritableConnection = async (
  ctx: {
    scope: { userId: string; workspaceId: string | null };
    serverDB: Parameters<typeof LinearConnectionModel.findById>[0];
    userId: string;
  },
  connectionId: string,
) => {
  const connection = await LinearConnectionModel.findById(ctx.serverDB, connectionId);
  const inScope =
    !!connection &&
    !connection.revokedAt &&
    (ctx.scope.workspaceId
      ? connection.workspaceId === ctx.scope.workspaceId
      : connection.userId === ctx.userId && !connection.workspaceId);
  if (!inScope) throw new TRPCError({ code: 'NOT_FOUND', message: 'Linear connection not found' });

  if (!(await canWriteScmScope(ctx.serverDB, ctx.userId, ctx.scope.workspaceId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'workspace member role required' });
  }
  return connection;
};

export type LinearRouter = typeof linearRouter;
