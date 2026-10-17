import { z } from 'zod';

import { resolveSandboxSessionConfig } from '@/server/services/sandbox';

import { entitledProcedure, mapStorageError, storageClaimProcedure } from './procedures';

export const storageProcedures = {
  /**
   * Whether this caller has a persistent workspace at all. The client pairs it
   * with the lab flag it already holds: flag off renders nothing, flag on
   * without an entitlement renders the upgrade prompt, and both renders the
   * workspace.
   */
  getEntitlement: storageClaimProcedure.query(async ({ ctx }) => ({
    entitled: Boolean(ctx.claim),
    quotaBytes: ctx.claim?.quotaBytes ?? null,
  })),
  /**
   * Where this topic's commands will run, for the prompt that describes it.
   *
   * The browser assembles the system role on the client-executor path, and it
   * cannot resolve this itself: the placement follows an entitlement that is
   * signed server-side. Without it the prompt fell back to the disposable
   * wording — "files created here are temporary" — while the run had a
   * persistent directory, and the model worked in /tmp on the strength of what
   * it had been told.
   *
   * Returns the placement only. The claim stays on this side; a browser has no
   * use for an entitlement it cannot sign anything with, and every sandbox call
   * it makes is routed through a server that resolves the claim again.
   */
  resolveSessionPlacement: storageClaimProcedure
    .input(z.object({ topicId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { claim, cwd, mode, workingDir } = await resolveSandboxSessionConfig({
        isShareVisitorRun: false,
        serverDB: ctx.serverDB,
        topicId: input.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return claim ? { cwd, mode, workingDir } : null;
    }),
  getStorage: entitledProcedure.query(async ({ ctx }) =>
    ctx.client.getStorage().catch(mapStorageError),
  ),
  /**
   * Re-measure the workspace and answer with the fresh figure.
   *
   * A mutation rather than a query because it writes: it walks the volume and
   * stamps the workspace as active. Kept off page load for that reason — the
   * settings page reads the stored number and offers this on its refresh
   * button, so a page nobody asked to refresh cannot keep an idle workspace
   * looking busy.
   */
  refreshStorageUsage: entitledProcedure.mutation(async ({ ctx }) =>
    ctx.client.refreshUsage().catch(mapStorageError),
  ),
};
