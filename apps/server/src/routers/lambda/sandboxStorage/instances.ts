import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { forgetDriveFolders, sandboxStorageBinding } from '@/server/services/sandbox';
import { stopSandboxInstance } from '@/server/services/sandbox/stopInstance';

import { rethrowDuplicateInstanceDirectory } from './constraintErrors';
import {
  assertFolderFree,
  assertNotLeftOnPublicDrive,
  driveForEnvironment,
  resolveInstanceDrive,
} from './driveScope';
import { createDerivedInstance, deleteInstanceSnapshot, isBuildable } from './instanceOperations';
import { instanceProcedure, mapStorageError } from './procedures';
import {
  driveSchema,
  idSchema,
  instanceDirectorySchema,
  nameSchema,
  topicIdSchema,
} from './schemas';

/**
 * The topic the execution plane keys its file-browser console sessions to.
 * The same literal market uses (`MANAGEMENT_TOPIC_ID`); it is not a topic of
 * ours, so it is never looked up and the run is shown as a console session.
 */
export const MANAGEMENT_TOPIC_ID = 'sandbox-workspace-console';

/** The index that keeps two instances out of the same directory. */

export const instancesRouter = router({
  /**
   * Fork an instance: a second directory that starts with everything the
   * first one had installed. The point of copying rather than creating is to
   * skip the rebuild — the specification alone would give an empty directory
   * and a fresh bootstrap.
   */
  copyInstance: instanceProcedure
    .input(
      z.object({
        id: idSchema,
        name: nameSchema,
        workingDirectory: instanceDirectorySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.instanceModel.findOwnedById(input.id);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      // Beside the source, on the same drive: the copy starts from the
      // source's snapshot, which lives on that drive's volume.
      const sourceDrive = await resolveInstanceDrive(ctx, source);
      const { claim, client } = sourceDrive;
      await assertNotLeftOnPublicDrive(ctx, source, sourceDrive);
      await assertFolderFree(client, input.workingDirectory);

      // A held instance is mid-write, so a copy would capture a tree halfway
      // through a change. The execution plane refuses it too; asking first
      // keeps the refusal ahead of the row insert and gives it the same code
      // the rest of the client already turns into a sentence. A lease store
      // that did not answer is not read as "free" — here that means refusing,
      // because unlike a rebuild there is no runtime lease standing behind a
      // copy to catch the second writer.
      const occupancy = await client
        .readOccupancy({ names: [source.id] })
        .catch(() => ({ held: [], unavailable: true }));
      if (occupancy.unavailable || occupancy.held.some((entry) => entry.id === source.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });
      }

      // Row first: a copy whose snapshot succeeded but whose row is missing
      // would be captured state nobody can name, and therefore nobody can
      // delete. The reverse — a row whose snapshot never arrived — is the same
      // state as a brand-new instance, which the UI already handles.
      const created = await ctx.instanceModel
        .create({
          ...sandboxStorageBinding(claim.key),
          // The copy's files are the source's, so its definition is too. Left
          // to default, it would snapshot whatever the environment says now
          // and describe a checkout the copied tree does not contain.
          configurationSnapshot: source.configurationSnapshot,
          environmentId: source.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      await client
        .copyInstance({
          from: source.id,
          // The copy's own folder. Sharing the source's would let either
          // instance's next save delete files the other still lists.
          instanceDir: created.workingDirectory,
          to: created.id,
        })
        .catch(async (error) => {
          await ctx.instanceModel.delete(created.id);
          return mapStorageError(error);
        });

      // A copy starts life with everything the source had built, so it is
      // ready by arrival — there is nothing to clone and nothing to install.
      // Left at the insert's default it would sit in `pending` with no build
      // to wait for, which reads as "never built" and offers a rebuild that
      // would throw the copy away.
      await ctx.instanceModel.update(created.id, { status: 'ready' });

      return { ...created, status: 'ready' as const };
    }),
  /**
   * A new instance of an environment, with its directory derived rather than
   * asked for.
   *
   * The person picked an environment, not a folder. Under the agreed split the
   * checkout and its installed packages live on local disk and travel in the
   * snapshot, so this directory holds the outputs worth keeping — which is
   * rarely something anyone has an opinion about before the work exists. Asking
   * would make them invent an answer to start a conversation.
   */
  createInstanceForEnvironment: instanceProcedure
    .input(z.object({ environmentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      // Owner-scoped: an environment a colleague published is one you can run
      // in, not one you can add copies to.
      const environment = await ctx.environmentModel.findOwnedById(input.environmentId);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      const access = await ctx.drives.client(driveForEnvironment(environment, ctx.workspaceId));
      if (!access) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This account has no persistent sandbox workspace',
        });
      }

      return createDerivedInstance(ctx.instanceModel, access.client, access.claim.key, environment);
    }),
  /**
   * Initialize a folder from an environment: an environment directory at the
   * drive's root, with its own captured state. Created unbuilt — the caller
   * starts the build next, the same split as for any other new instance.
   *
   * Only a new folder, or an empty one. Building into a folder that already
   * holds work would mix a checkout into it, and a later rebuild would throw
   * that work away with the old checkout.
   */
  createInstance: instanceProcedure
    .input(
      z.object({
        environmentId: idSchema,
        name: nameSchema,
        workingDirectory: instanceDirectorySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The environment decides the drive, not the drive being browsed: a
      // private environment's directory goes on its owner's personal drive,
      // where no other member can reach the home directory it captures.
      const environment = await ctx.environmentModel.findOwnedById(input.environmentId);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      const drive = driveForEnvironment(environment, ctx.workspaceId);
      const access = await ctx.drives.client(drive);
      if (!access) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This account has no persistent sandbox workspace',
        });
      }

      await assertFolderFree(access.client, input.workingDirectory);

      const created = await ctx.instanceModel
        .create({
          ...sandboxStorageBinding(access.claim.key),
          environmentId: input.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      forgetDriveFolders(access.claim.key);

      return { ...created, drive };
    }),
  /**
   * One instance, from the database alone. Separate from `listInstances`
   * because the composer only needs to know where the conversation is pointed,
   * and `listInstances` pays a sandbox cold start to answer how big everything
   * is — seconds, for a label.
   */
  getInstance: instanceProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const instance = await ctx.instanceModel.findById(input.id);
    if (!instance) return null;

    // Which of the caller's drives it is on, for the composer's label —
    // `null` on a drive that is not theirs, which the run refuses.
    return { ...instance, drive: ctx.drives.driveOf(instance.providerScope) ?? null };
  }),
  /**
   * Instances, each joined with the state the execution plane actually
   * holds for it. An instance that was created but never used has no snapshot
   * yet, which is a normal state and not an error.
   */
  listInstances: instanceProcedure
    .input(
      z.object({
        /**
         * Only the instances on this drive — what a picker browsing one drive
         * asks for. Without it, every instance on any of the caller's drives,
         * which is what the environments page lists.
         */
        drive: driveSchema,
        environmentId: idSchema.optional(),
        topicId: topicIdSchema,
        /**
         * Sizes come from the snapshot store, which is reachable only through a
         * sandbox session and pays a cold start to answer. A settings page is
         * worth that wait; a picker in the composer is not, and asks for names
         * alone.
         */
        withSizes: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      // An instance on a drive that is not the caller's — a colleague's
      // personal drive, under an environment they have since published — is
      // not one the caller can run in, list the files of, or size.
      const located = (await ctx.instanceModel.query({ environmentId: input.environmentId }))
        .map((instance) => ({ drive: ctx.drives.driveOf(instance.providerScope), instance }))
        .filter(
          (entry): entry is { drive: SandboxDrive; instance: typeof entry.instance } =>
            !!entry.drive && (!input.drive || entry.drive === ctx.drive),
        );
      const instances = located.map((entry) => entry.instance);
      const driveById = new Map(located.map((entry) => [entry.instance.id, entry.drive]));

      // Private environments' directories left on the public drive: listed
      // for their owner — the only member who sees a private environment —
      // with the instruction to rebuild them, and run by nobody.
      const publicAccess =
        ctx.workspaceId && located.some((entry) => entry.drive === 'public')
          ? await ctx.drives.client('public')
          : undefined;
      const rebuildRequired = new Set(
        publicAccess
          ? (
              await ctx.instanceModel.listStorageDirectories(
                sandboxStorageBinding(publicAccess.claim.key),
              )
            )
              .filter((entry) => entry.isPrivate)
              .map((entry) => entry.id)
          : [],
      );

      // One client per drive, since each drive's snapshots and leases are
      // read through a claim for that drive.
      const drives = [...new Set(located.map((entry) => entry.drive))];
      const perDrive = await pMap(
        drives,
        async (drive) => {
          const access = await ctx.drives.client(drive);
          const names = located
            .filter((entry) => entry.drive === drive)
            .map((entry) => entry.instance.id);

          const [snapshots, occupancy] = await Promise.all([
            input.withSizes && access
              ? access.client
                  .listInstances({ topicId: input.topicId })
                  .then((result) => result.instances)
                  // If the store fails, the instances still exist and can
                  // still be renamed or selected — only their sizes are
                  // unknown, so say so rather than failing a settings page.
                  .catch(() => null)
              : input.withSizes
                ? null
                : [],
            // Always, and separately from the sizes: this is a Redis read on
            // the control plane, so it costs the same on every deployment,
            // whereas the listing above opens the volume. An instance held by
            // another conversation cannot be run in — the lease answers the
            // second writer with a 409 — so a picker that does not know is a
            // picker that offers a choice the first message will refuse.
            access && names.length > 0
              ? access.client
                  .readOccupancy({ names, topicId: input.topicId })
                  // Same rule the lease store itself follows: a failure is
                  // "not known", never "free".
                  .catch(() => ({ held: [], unavailable: true }))
              : { held: [], unavailable: !access && names.length > 0 },
          ]);

          return { access, drive, occupancy, snapshots };
        },
        { concurrency: 5 },
      );
      const clientByDrive = new Map(
        perDrive.flatMap((entry) => (entry.access ? [[entry.drive, entry.access.client]] : [])),
      );

      // A build is polled by whoever has the Instances tab open, and nobody
      // has it open most of the time — switch tabs mid-build and the verdict
      // never lands, leaving the row `pending` against a build the runtime
      // has since discarded and an instance the composer will not offer. So
      // every listing settles the builds it finds already finished. Bounded
      // by how many instances can be building at once, and never fatal: an
      // unreachable execution plane just leaves the row as it was.
      const settled = await pMap(
        instances.filter((instance) => instance.buildId),
        async (instance) => {
          const client = clientByDrive.get(driveById.get(instance.id)!);
          if (!client) return null;
          const status = await client
            .buildStatus({ buildId: instance.buildId!, name: instance.id, topicId: input.topicId })
            .catch(() => null);
          if (!status || status.state === 'running') return null;

          const next = {
            buildError:
              status.state === 'failed' ? status.chunk.slice(-2000) || 'Build failed' : null,
            status: status.state === 'succeeded' ? ('ready' as const) : ('error' as const),
          };
          await ctx.instanceModel
            .recordBuildResult(instance.id, instance.buildId!, next)
            .catch(() => undefined);

          return [instance.id, next] as const;
        },
        { concurrency: 5 },
      );
      const settledById = new Map(settled.filter((entry) => !!entry));

      const byId = new Map(
        perDrive.flatMap((entry) =>
          (entry.snapshots ?? []).map((snapshot) => [snapshot.id, snapshot] as const),
        ),
      );
      const heldBy = new Map(
        perDrive.flatMap((entry) => entry.occupancy.held.map((held) => [held.id, held.own])),
      );

      return {
        instances: instances.map((instance) => ({
          /** Set only while a build is worth polling; cleared with its verdict. */
          buildId: settledById.has(instance.id) ? null : instance.buildId,
          // From the definition the instance was made from, which is what a
          // build uses — the environment may have moved on since.
          buildable: isBuildable(instance.configurationSnapshot),
          buildError: settledById.get(instance.id)?.buildError ?? instance.buildError,
          createdAt: instance.createdAt,
          /** Which of the caller's drives the directory is on. */
          drive: driveById.get(instance.id)!,
          environmentId: instance.environmentId,
          id: instance.id,
          // Held by a running sandbox, and by whom. `own` is this topic's own
          // run, which its own picker must keep offering; anything else is
          // another conversation and is what a picker refuses.
          inUse: heldBy.has(instance.id),
          inUseByThisTopic: heldBy.get(instance.id) === true,
          name: instance.name,
          /**
           * A private environment's directory on the public drive, from
           * before members had drives of their own: hidden there, never run
           * in, and to be initialized again on the owner's personal drive.
           */
          rebuildRequired: rebuildRequired.has(instance.id),
          snapshot: byId.get(instance.id) ?? null,
          status: settledById.get(instance.id)?.status ?? instance.status,
          workingDirectory: instance.workingDirectory,
        })),
        occupancyUnavailable: perDrive.some((entry) => entry.occupancy.unavailable),
        snapshotsUnavailable: perDrive.some((entry) => entry.snapshots === null),
      };
    }),
  /**
   * The run history of every instance of one environment, newest first.
   *
   * The execution plane keys its trail by instance — that is the name the
   * snapshot is stored under — while the panel shows one environment, so this
   * is the union of the instances' histories with the instance named on each
   * row. Read from the control plane's own records: unlike `listInstances`
   * it starts no sandbox and pays no cold start.
   *
   * Topic titles are looked up for the caller's own topics; a run another
   * member started in a published environment keeps its id only.
   */
  listInstanceSessions: instanceProcedure
    .input(
      z.object({
        environmentId: idSchema,
        /** Per instance, not in total: each instance's page is fetched on its own. */
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const instances = (
        await ctx.instanceModel.query({ environmentId: input.environmentId })
      ).filter((instance) => ctx.drives.driveOf(instance.providerScope));
      if (instances.length === 0) return { sessions: [], unavailable: false };

      // Bounded: an environment's instance count is whatever the member made,
      // and one request per instance all at once would put that number on the
      // execution plane in a single burst.
      const pages = await pMap(
        instances,
        (instance) =>
          resolveInstanceDrive(ctx, instance)
            .then(({ client }) =>
              client.listEnvironmentSessions({ limit: input.limit, name: instance.id }),
            )
            // One instance's history failing must not blank the others; the
            // caller is told the list is incomplete rather than shown "no runs".
            .catch(() => null),
        { concurrency: 5 },
      );

      const merged = instances
        .flatMap((instance, index) =>
          (pages[index]?.sessions ?? []).map((session) => ({
            ...session,
            instanceId: instance.id,
            instanceName: instance.name,
          })),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      const topicIds = [
        ...new Set(
          merged
            .map((session) => session.topicId)
            .filter((id): id is string => !!id && id !== MANAGEMENT_TOPIC_ID),
        ),
      ];
      // Read in the workspace's scope — the personal scope matches no
      // workspace topic at all — and then narrowed to the caller's own, since
      // a workspace scope also reaches what other members may see.
      const topics =
        topicIds.length > 0
          ? await new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined)
              .findByIds(topicIds)
              .catch(() => [])
          : [];
      // Where the conversation lives, as well as what it is called: a topic is
      // addressed as `group/<groupId>/<topicId>` when it belongs to a group and
      // `agent/<agentId>/<topicId>` otherwise, so a link built from the topic
      // alone cannot resolve and the panel's one way back into the run is a 404.
      // A group topic carries BOTH ids, which is why the group one is returned
      // rather than inferred from the absence of an agent.
      const topicInfo = new Map(
        topics
          .filter((topic) => topic.userId === ctx.userId)
          .map((topic) => [
            topic.id,
            { agentId: topic.agentId, groupId: topic.groupId, title: topic.title },
          ]),
      );

      return {
        sessions: merged.map((session) => {
          const info = session.topicId ? topicInfo.get(session.topicId) : undefined;

          return {
            ...session,
            topicAgentId: info?.agentId ?? null,
            topicGroupId: info?.groupId ?? null,
            topicTitle: info?.title || null,
          };
        }),
        unavailable: pages.includes(null),
      };
    }),
  /**
   * Remove an environment directory: what its builds left on the drive, and
   * the row. Any of them, the first included — an environment owns no folder
   * of its own any more, so none is left to stand for it.
   */
  removeInstance: instanceProcedure
    .input(z.object({ id: idSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // Snapshot first, and only drop the row once it is gone: a row removed
      // while the snapshot survives leaves storage nobody can see, name, or
      // reclaim. The execution plane refuses while a session is using it, and
      // that refusal is the one the user needs to see.
      const { claim, client } = await resolveInstanceDrive(ctx, instance);
      await deleteInstanceSnapshot(client, instance.id, input.topicId);
      forgetDriveFolders(claim.key);

      return ctx.instanceModel.delete(input.id);
    }),
  /**
   * End the run holding an instance, so it can be picked, rebuilt or deleted
   * now instead of after the idle sweep.
   *
   * The owner's, like a rebuild or a delete: in a published environment the
   * run holding the instance is usually a colleague's conversation, and
   * cutting it off is not something reading access should allow. The
   * execution plane does the stop properly — snapshot first, lease released
   * only once the stop is confirmed — and its refusals (still saving, still
   * starting, being built) travel as codes the client turns into sentences.
   */
  stopInstance: instanceProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // On the drive the instance is on, then the shared stop: it interrupts
      // the conversation holding the copy before releasing it.
      const { client } = await resolveInstanceDrive(ctx, instance);

      return stopSandboxInstance({ ...ctx, client, id: input.id }).catch(mapStorageError);
    }),
  renameInstance: instanceProcedure
    .input(z.object({ id: idSchema, name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const updated = await ctx.instanceModel.update(id, changes);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      return updated;
    }),
});
