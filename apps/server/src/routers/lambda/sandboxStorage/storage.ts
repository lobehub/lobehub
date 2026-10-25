import { z } from 'zod';

import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { readDriveUsage, resolveSandboxSessionConfig } from '@/server/services/sandbox';

import { entitledProcedure, mapStorageError, storageClaimProcedure } from './procedures';
import { driveSchema, topicIdSchema } from './schemas';

export const storageRouter = router({
  /**
   * Whether this caller has a persistent workspace at all. The client pairs it
   * with the lab flag it already holds: flag off renders nothing, flag on
   * without an entitlement renders the upgrade prompt, and both renders the
   * workspace.
   */
  getEntitlement: storageClaimProcedure.query(async ({ ctx }) => ({
    /**
     * The drives this caller has: `public` and `personal` in a workspace,
     * `personal` alone in a personal account. Both of a workspace's drive
     * share one plan, so one is entitled exactly when the other is.
     */
    drives: ctx.drives.available,
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
      const { claim, cwd, drive, fallback, mode, workingDir } = await resolveSandboxSessionConfig({
        isShareVisitorRun: false,
        serverDB: ctx.serverDB,
        topicId: input.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // `fallback` says why a folder or environment directory the topic picked
      // is not where this run goes, so the composer can tell the person
      // before they send rather than after the work went somewhere temporary.
      return claim ? { cwd, drive, fallback, mode, workingDir } : null;
    }),
  // A topic stands for the drive it picked, so the working panel's tree is
  // rooted on the drive its files are actually on.
  getStorage: entitledProcedure
    .input(z.object({ drive: driveSchema, topicId: topicIdSchema }).optional())
    .query(async ({ ctx }) => ctx.client.getStorage().catch(mapStorageError)),
  /**
   * How much each of the caller's drives holds against the plan's quota.
   *
   * A workspace's public drive and every member's personal drive draw on one
   * pool, so the figure that decides whether a write is refused is their sum
   * — the execution plane reports it beside each drive's own. An owner or
   * admin is also shown how much each other member's personal drive holds:
   * the amount, which is the workspace's to pay for, and never the contents,
   * which stay out of reach of every claim this router issues.
   */
  getDriveUsage: entitledProcedure.query(async ({ ctx }) =>
    readDriveUsage({
      claim: ctx.claim,
      drives: ctx.drives,
      role: (ctx as { workspaceRole?: WorkspaceRole }).workspaceRole,
      serverDB: ctx.serverDB,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? undefined,
    }),
  ),
  refreshStorageUsage: entitledProcedure
    .input(z.object({ drive: driveSchema }).optional())
    .mutation(async ({ ctx }) => ctx.client.refreshUsage().catch(mapStorageError)),
});
