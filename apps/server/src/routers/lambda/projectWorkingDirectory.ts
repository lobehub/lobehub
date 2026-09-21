import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
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
import { deviceGateway } from '@/server/services/deviceGateway';

import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
  assertCanViewTopicTargets,
} from './_helpers/conversationResourceGuard';

const procedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { serverDB, userId, workspaceId } = opts.ctx;
  return opts.next({
    ctx: {
      directoryModel: new ProjectWorkingDirectoryModel(serverDB, userId, workspaceId ?? undefined),
      directoryRepo: new ProjectDirectoryRepository(serverDB, userId, workspaceId ?? undefined),
      environmentModel: new EnvironmentModel(serverDB, userId, workspaceId ?? undefined),
      projectModel: new ProjectModel(serverDB, userId, workspaceId ?? undefined),
      topicModel: new TopicModel(serverDB, userId, workspaceId ?? undefined),
    },
  });
});
const write = procedure.use(withScopedPermission('agent:update'));
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
      await assertCanUseTopicTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        [input.topicId],
      );
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
      if (!(await ctx.projectModel.findManageableById(input.projectId)))
        throw new Error('Project not found or access denied');
      return {
        data: await ctx.topicModel.create({
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
      return { data, success: true };
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
      return {
        data: await ctx.topicModel.create({
          agentId: input.agentId,
          metadata: {
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
