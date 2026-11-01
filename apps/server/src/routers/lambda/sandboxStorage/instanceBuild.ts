import { toExecutionConfiguration } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { resolveScmCloneCredential } from '@/server/services/scm/cloneCredential';

import { assertNotLeftOnPublicDrive, resolveInstanceDrive } from './driveScope';
import { isBuildable } from './instanceOperations';
import { instanceProcedure, mapStorageError } from './procedures';
import { idSchema, topicIdSchema } from './schemas';

export const instanceBuildRouter = router({
  /**
   * Materialize an instance: clone the environment's sources and run its
   * bootstrap, into the instance's own stored generation.
   *
   * Its own mutation rather than part of `createInstance`, because starting a
   * build attaches a sandbox session and that is a cold start — seconds, with
   * a dialog open in front of it. The dialog closes on the insert; the list
   * shows the instance as pending and this is what the client fires next.
   *
   * Returns as soon as the build has started: a bootstrap running an install
   * is minutes long, and `instanceBuildStatus` is what follows it.
   */
  startInstanceBuild: instanceProcedure
    .input(z.object({ id: idSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      const instanceDrive = await resolveInstanceDrive(ctx, instance);
      const { client } = instanceDrive;
      await assertNotLeftOnPublicDrive(ctx, instance, instanceDrive);

      // The definition this instance was created from, not the environment's
      // current one: a build has to produce what the instance says it is, and
      // the two differ exactly when the environment moved on.
      const specification = instance.configurationSnapshot;
      const buildable = isBuildable(specification);

      // An environment that clones nothing and installs nothing is already
      // everything it is ever going to be. Building it would cold-start a
      // sandbox to do nothing and leave an empty archive behind.
      if (!buildable) {
        await ctx.instanceModel.update(input.id, { status: 'ready' });

        return { buildId: null };
      }

      // A rebuild replaces the folder a conversation may be writing in right
      // now, so a held instance is refused before the row changes at all. A
      // lease store that did not answer is not read as "free" — the runtime's
      // own lease still stands behind this and refuses a second writer.
      const occupancy = await client
        .readOccupancy({ names: [input.id], topicId: input.topicId })
        .catch(() => ({ held: [], unavailable: true }));
      if (occupancy.held.some((entry) => entry.id === input.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });
      }

      // What to fall back to if the build never starts. An instance that was
      // ready still has everything its last build published — a refused start
      // takes none of it away, so it must not come back reading "failed".
      const previousStatus = instance.status;

      await ctx.instanceModel.update(input.id, { buildError: null, status: 'pending' });

      // Preferred over the execution plane's own GitHub connection, which it
      // falls back to when this answers null: an App installation is granted
      // one repository at a time by whoever administers the account, and the
      // token minted from it is narrower still — this repository, read-only,
      // expiring within the hour. It is resolved here because the App's
      // private key lives on this side; the execution plane is handed the
      // result and never the inputs, the same way it is handed the workspace
      // claim.
      const credential = await resolveScmCloneCredential({
        configuration: specification,
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      try {
        const { buildId } = await client.buildInstance({
          credentials: credential ? [credential] : undefined,
          // Where the checkout lands on the volume: the instance's own folder,
          // which is what its file browser opens.
          instanceDir: instance.workingDirectory,
          name: input.id,
          // Without the product's own fields: the execution plane digests
          // what it is sent, and an instance created before `kind` existed
          // must keep matching the build it already has.
          specification: toExecutionConfiguration(specification),
          topicId: input.topicId,
        });
        await ctx.instanceModel.update(input.id, { buildId });

        return { buildId };
      } catch (error) {
        // Recorded on the row rather than only thrown: the client that asked
        // may already be gone, and an instance left saying "pending" forever
        // is the one state nothing recovers from.
        await ctx.instanceModel.update(
          input.id,
          previousStatus === 'ready'
            ? { status: 'ready' }
            : {
                buildError: (error as Error)?.message || 'Could not start the build',
                status: 'error',
              },
        );
        throw error;
      }
    }),
  /**
   * Follow a build, and settle the instance once it ends.
   *
   * A query that writes, deliberately: the runtime is the only thing that
   * knows a build finished, nothing calls back, and the row has to end up
   * right whether or not anyone is still watching. Polling it is what moves
   * the instance out of `pending`.
   */
  instanceBuildStatus: instanceProcedure
    .input(
      z.object({
        id: idSchema,
        /** Resume the log from here; the reply says where to go next. */
        logOffset: z.number().int().min(0).optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      if (!instance.buildId) {
        return {
          chunk: '',
          logOffset: input.logOffset ?? 0,
          state: instance.status === 'error' ? ('failed' as const) : ('idle' as const),
        };
      }

      const { client } = await resolveInstanceDrive(ctx, instance);
      const status = await client
        .buildStatus({
          buildId: instance.buildId,
          logOffset: input.logOffset,
          name: input.id,
          topicId: input.topicId,
        })
        .catch(mapStorageError);

      if (status.state !== 'running') {
        // The id is cleared with the verdict: the runtime drops a finished
        // build's log on its own schedule, and an id that outlives it has the
        // UI polling for a log that will never come back. Written through the
        // visibility-scoped recorder, because the poll that happens to receive
        // the terminal status can be a viewer's rather than the owner's.
        await ctx.instanceModel.recordBuildResult(input.id, instance.buildId, {
          buildError:
            status.state === 'failed' ? status.chunk.slice(-2000) || 'Build failed' : null,
          status: status.state === 'succeeded' ? 'ready' : 'error',
        });
      }

      return { chunk: status.chunk, logOffset: status.logOffset, state: status.state };
    }),
});
