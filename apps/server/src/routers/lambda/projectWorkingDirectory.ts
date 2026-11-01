import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import { ProjectModel } from '@/database/models/project';
import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';
import { TopicModel } from '@/database/models/topic';
import { ProjectDirectoryRepository } from '@/database/repositories/projectDirectory';
import { agents } from '@/database/schemas';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  createAgentConfigResolver,
  resolvePrecreatedTopicSnapshot,
} from '@/server/services/aiAgent/pipeline/precreatedTopic';
import { deviceGateway } from '@/server/services/deviceGateway';

import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
  assertCanViewTopicTargets,
} from './_helpers/conversationResourceGuard';
import { getResourceConfigAccess } from './_helpers/resourceConfigGuard';
import { assertCreatorTopicTargets } from './_helpers/shareVisitorTargetGuard';

const procedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { serverDB, userId, workspaceId } = opts.ctx;
  return opts.next({
    ctx: {
      directoryModel: new ProjectWorkingDirectoryModel(serverDB, userId, workspaceId ?? undefined),
      directoryRepo: new ProjectDirectoryRepository(serverDB, userId, workspaceId ?? undefined),
      environmentModel: new EnvironmentModel(serverDB, userId, workspaceId ?? undefined),
      projectModel: new ProjectModel(serverDB, userId, workspaceId ?? undefined),
      topicModel: new TopicModel(serverDB, userId, workspaceId ?? undefined),
      // Topics written here exist before any run does, so they have to pin their
      // own model snapshot — see `resolvePrecreatedTopicSnapshot`.
      precreatedTopicDeps: {
        db: serverDB,
        resolveAgentConfigOrThrow: createAgentConfigResolver(
          serverDB,
          userId,
          workspaceId ?? undefined,
        ),
        userId,
        workspaceId: workspaceId ?? undefined,
      },
    },
  });
});
const write = procedure.use(withScopedPermission('agent:update'));

/** Per-agent permission lookups each hit the database; a large project must not fan out unbounded. */
const CONFIG_ACCESS_LOOKUP_CONCURRENCY = 5;

/**
 * An agent's bound device is edit-level config (see `redactAgentConfig`): a
 * reader without full config access keeps the pin's policy but not its device,
 * so the sidebar offers that agent no device starts instead of leaking the id.
 */
const redactAgentDevicePins = async <
  T extends { agentBoundDeviceId: string | null; agentId: string | null },
>(
  ctx: {
    serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
    userId: string;
    workspaceId?: string | null;
    workspacePermissionCodes?: string[];
  },
  rows: T[],
): Promise<T[]> => {
  if (!ctx.workspaceId) return rows;
  const pinnedAgentIds = [
    ...new Set(rows.flatMap((row) => (row.agentId && row.agentBoundDeviceId ? [row.agentId] : []))),
  ];
  const fullAccess = new Set<string>();
  await pMap(
    pinnedAgentIds,
    async (agentId) => {
      const access = await getResourceConfigAccess(
        {
          db: ctx.serverDB,
          grantedPermissions: ctx.workspacePermissionCodes,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        'agent',
        agentId,
      );
      if (access === 'full') fullAccess.add(agentId);
    },
    { concurrency: CONFIG_ACCESS_LOOKUP_CONCURRENCY },
  );
  return rows.map((row) =>
    row.agentBoundDeviceId && !(row.agentId && fullAccess.has(row.agentId))
      ? { ...row, agentBoundDeviceId: null }
      : row,
  );
};
const idInput = z.object({ id: z.string().uuid() });

export const projectWorkingDirectoryRouter = router({
  associateTopic: write
    .input(
      z.object({
        projectId: z.string(),
        topicId: z.string(),
        directoryId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const guardCtx = { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId };
      await assertCanUseTopicTargets(guardCtx, [input.topicId]);
      // Same visitor guard as `moveTopic`: a share-visitor topic is not the
      // member's conversation to file into a project.
      await assertCreatorTopicTargets(guardCtx, [input.topicId]);
      return {
        data: await ctx.directoryRepo.associateTopic(
          input.projectId,
          input.topicId,
          input.directoryId,
        ),
        success: true,
      };
    }),
  createProjectTopic: procedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string(),
        title: z.string().trim().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanUseConversationTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        [{ agentId: input.agentId }],
      );
      // Everyone who can read a project collaborates in it, so starting a
      // project conversation needs read access, not ownership.
      if (!(await ctx.projectModel.findById(input.projectId)))
        throw new Error('Project not found or access denied');
      const { snapshot } = await resolvePrecreatedTopicSnapshot(
        ctx.precreatedTopicDeps,
        input.agentId,
      );
      return {
        data: await ctx.topicModel.create({
          ...snapshot,
          agentId: input.agentId,
          projectId: input.projectId,
          title: input.title,
        }),
        success: true,
      };
    }),
  listProjectTopics: procedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const data = await ctx.projectModel.listTopics(input.projectId);
      await assertCanViewTopicTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        data.map((topic) => topic.id),
      );
      return { data: await redactAgentDevicePins(ctx, data), success: true };
    }),
  attachEnvironment: write
    .input(z.object({ projectId: z.string(), environmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.projectModel.attachEnvironment(input.projectId, input.environmentId),
      success: true,
    })),
  listEnvironments: procedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ ctx, input }) => ({
      data: input.projectId
        ? await ctx.projectModel.listEnvironments(input.projectId)
        : await ctx.environmentModel.list(),
      success: true,
    })),
  saveEnvironment: write
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(255),
        repositoryUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.environmentModel.save(input),
      success: true,
    })),
  bind: write
    .input(
      z.object({
        agentId: z.string().optional(),
        deviceId: z.string().min(1),
        environmentId: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(255),
        path: z.string().min(1),
        projectId: z.string().min(1),
        repositoryUrl: z.string().optional(),
        topicIds: z.array(z.string()).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.topicIds?.length)
        await assertCanUseTopicTargets(
          { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
          input.topicIds,
        );
      return { data: await ctx.directoryRepo.bind(input), success: true };
    }),
  list: procedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.directoryModel.list(input.projectId),
      success: true,
    })),
  listTopics: procedure.input(idInput).query(async ({ ctx, input }) => {
    const data = await ctx.directoryModel.listTopics(input.id);
    await assertCanViewTopicTargets(
      { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
      data.map((topic) => topic.id),
    );
    return { data, success: true };
  }),
  /** Switch a project-directory conversation to its project's directory on another device. */
  moveTopic: procedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ directoryId: z.string().uuid(), topicId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanUseTopicTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        [input.topicId],
      );
      // Same visitor guard as `updateTopicMetadata`: a share-visitor topic is not
      // the member's conversation to move.
      await assertCreatorTopicTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        [input.topicId],
      );
      // Same reachability gate as `startTopic`: the move drops the session that
      // only holds on the old machine, so a destination the device cannot see
      // must fail here, while the existing binding and session are still intact.
      const directory = await ctx.directoryModel.resolve(input.directoryId);
      const stat = await deviceGateway.statPath({
        deviceId: directory.deviceId,
        path: directory.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (!stat?.exists || !stat.isDirectory)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Device is offline or working directory is unavailable',
        });
      return {
        data: await ctx.directoryRepo.moveTopic(input.topicId, input.directoryId),
        success: true,
      };
    }),
  resolve: procedure.input(idInput).query(async ({ ctx, input }) => ({
    data: await ctx.directoryModel.resolve(input.id),
    success: true,
  })),
  startTopic: procedure
    .use(withScopedPermission('topic:create'))
    .input(idInput.extend({ agentId: z.string(), title: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      await assertCanUseConversationTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        [{ agentId: input.agentId }],
      );
      const directory = await ctx.directoryModel.resolve(input.id);
      const [agent] = await ctx.serverDB
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, input.agentId),
            buildWorkspaceWhere(
              { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
              agents,
            ),
          ),
        );
      if (!agent) throw new Error('Agent not found or access denied');
      if (
        agent.agencyConfig?.executionTargetSelectionPolicy === 'fixed' &&
        agent.agencyConfig.boundDeviceId !== directory.deviceId
      )
        throw new Error('This agent is fixed to another execution target');
      const stat = await deviceGateway.statPath({
        deviceId: directory.deviceId,
        path: directory.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (!stat?.exists || !stat.isDirectory)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Device is offline or working directory is unavailable',
        });
      const { snapshot } = await resolvePrecreatedTopicSnapshot(
        ctx.precreatedTopicDeps,
        input.agentId,
      );
      return {
        data: await ctx.topicModel.create({
          ...snapshot,
          agentId: input.agentId,
          // The reasoning snapshot lives in `metadata` too, so merge rather than
          // replace it with the directory pin.
          metadata: {
            ...snapshot.metadata,
            boundDeviceId: directory.deviceId,
            workingDirectory: directory.path,
            workingDirectoryConfig: { path: directory.path },
          },
          projectId: directory.projectId,
          projectWorkingDirectoryId: directory.id,
          title: input.title,
        }),
        success: true,
      };
    }),
});
