import { isDefaultInstance } from '@lobechat/utils/environmentInstance';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { TopicModel } from '@/database/models/topic';

import { rethrowDuplicateInstanceDirectory } from './constraintErrors';
import {
  createDerivedInstance,
  deleteInstanceSnapshot,
  isBuildable,
  sandboxBinding,
} from './instanceOperations';
import { instanceProcedure, mapStorageError } from './procedures';
import { idSchema, nameSchema, relativePathSchema, topicIdSchema } from './schemas';

/**
 * The topic the execution plane keys its file-browser console sessions to.
 * The same literal market uses (`MANAGEMENT_TOPIC_ID`); it is not a topic of
 * ours, so it is never looked up and the run is shown as a console session.
 */
const MANAGEMENT_TOPIC_ID = 'sandbox-workspace-console';

export const instancesProcedures = {
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
        workingDirectory: relativePathSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.instanceModel.findOwnedById(input.id);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // A held instance is mid-write, so a copy would capture a tree halfway
      // through a change. The execution plane refuses it too; asking first
      // keeps the refusal ahead of the row insert and gives it the same code
      // the rest of the client already turns into a sentence. A lease store
      // that did not answer is not read as "free" — here that means refusing,
      // because unlike a rebuild there is no runtime lease standing behind a
      // copy to catch the second writer.
      const occupancy = await ctx.client
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
          ...sandboxBinding(ctx.claim.key),
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

      await ctx.client
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

      return createDerivedInstance(ctx.instanceModel, ctx.claim.key, environment);
    }),
  /**
   * An instance of an environment: its own directory, its own captured
   * state. Created empty — nothing is built until a conversation runs in it.
   */
  createInstance: instanceProcedure
    .input(
      z.object({
        environmentId: idSchema,
        name: nameSchema,
        workingDirectory: relativePathSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.instanceModel
        .create({
          ...sandboxBinding(ctx.claim.key),
          environmentId: input.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return created;
    }),
  /**
   * One instance, from the database alone. Separate from `listInstances`
   * because the composer only needs to know where the conversation is pointed,
   * and `listInstances` pays a sandbox cold start to answer how big everything
   * is — seconds, for a label.
   */
  getInstance: instanceProcedure
    .input(z.object({ id: idSchema }))
    .query(async ({ ctx, input }) => (await ctx.instanceModel.findById(input.id)) ?? null),
  /**
   * Instances, each joined with the state the execution plane actually
   * holds for it. An instance that was created but never used has no snapshot
   * yet, which is a normal state and not an error.
   */
  listInstances: instanceProcedure
    .input(
      z.object({
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
      const instances = await ctx.instanceModel.query({ environmentId: input.environmentId });

      const [snapshots, occupancy] = await Promise.all([
        input.withSizes
          ? ctx.client
              .listInstances({ topicId: input.topicId })
              .then((result) => result.instances)
              // If the store fails, the instances still exist and can still be
              // renamed or selected — only their sizes are unknown, so say so
              // rather than failing a settings page.
              .catch(() => null)
          : [],
        // Always, and separately from the sizes: this is a Redis read on the
        // control plane, so it costs the same on every deployment, whereas the
        // listing above opens the volume. An instance held by another
        // conversation cannot be run in — the lease answers the second writer
        // with a 409 — so a picker that does not know is a picker that offers
        // a choice the first message will refuse.
        instances.length > 0
          ? ctx.client
              .readOccupancy({
                names: instances.map((instance) => instance.id),
                topicId: input.topicId,
              })
              // Same rule the lease store itself follows: a failure is "not
              // known", never "free".
              .catch(() => ({ held: [], unavailable: true }))
          : { held: [], unavailable: false },
      ]);

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
          const status = await ctx.client
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

      const byId = new Map((snapshots ?? []).map((snapshot) => [snapshot.id, snapshot]));
      const heldBy = new Map(occupancy.held.map((entry) => [entry.id, entry.own]));

      return {
        instances: instances.map((instance) => ({
          /** Set only while a build is worth polling; cleared with its verdict. */
          buildId: settledById.has(instance.id) ? null : instance.buildId,
          // From the definition the instance was made from, which is what a
          // build uses — the environment may have moved on since.
          buildable: isBuildable(instance.configurationSnapshot),
          buildError: settledById.get(instance.id)?.buildError ?? instance.buildError,
          createdAt: instance.createdAt,
          environmentId: instance.environmentId,
          id: instance.id,
          // Held by a running sandbox, and by whom. `own` is this topic's own
          // run, which its own picker must keep offering; anything else is
          // another conversation and is what a picker refuses.
          inUse: heldBy.has(instance.id),
          inUseByThisTopic: heldBy.get(instance.id) === true,
          name: instance.name,
          snapshot: byId.get(instance.id) ?? null,
          status: settledById.get(instance.id)?.status ?? instance.status,
          workingDirectory: instance.workingDirectory,
        })),
        occupancyUnavailable: occupancy.unavailable,
        snapshotsUnavailable: snapshots === null,
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
      const instances = await ctx.instanceModel.query({ environmentId: input.environmentId });
      if (instances.length === 0) return { sessions: [], unavailable: false };

      // Bounded: an environment's instance count is whatever the member made,
      // and one request per instance all at once would put that number on the
      // execution plane in a single burst.
      const pages = await pMap(
        instances,
        (instance) =>
          ctx.client
            .listEnvironmentSessions({ limit: input.limit, name: instance.id })
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
   * Remove one copy of an environment. The default instance is refused: it is
   * what the environment is, so it goes when the environment does, and a
   * broken one is rebuilt rather than deleted.
   */
  removeInstance: instanceProcedure
    .input(z.object({ id: idSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      const siblings = await ctx.instanceModel.query({ environmentId: instance.environmentId });
      if (isDefaultInstance(instance, siblings)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'DEFAULT_INSTANCE' });
      }

      // Snapshot first, and only drop the row once it is gone: a row removed
      // while the snapshot survives leaves storage nobody can see, name, or
      // reclaim. The execution plane refuses while a session is using it, and
      // that refusal is the one the user needs to see.
      await deleteInstanceSnapshot(ctx.client, instance.id, input.topicId);

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

      return ctx.client.stopInstance({ name: instance.id }).catch(mapStorageError);
    }),
  renameInstance: instanceProcedure
    .input(z.object({ id: idSchema, name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const updated = await ctx.instanceModel.update(id, changes);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      return updated;
    }),
};
