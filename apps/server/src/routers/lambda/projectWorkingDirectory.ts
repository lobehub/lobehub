import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { deviceGateway } from '@/server/services/deviceGateway';

import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
  assertCanViewTopicTargets,
} from './_helpers/conversationResourceGuard';

const procedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      directoryModel: new ProjectWorkingDirectoryModel(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  }),
);
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
        data: await ctx.directoryModel.associateTopic(
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
      return {
        data: await ctx.directoryModel.createProjectTopic(
          input.projectId,
          input.agentId,
          input.title,
        ),
        success: true,
      };
    }),
  listProjectTopics: procedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const data = await ctx.directoryModel.listProjectTopics(input.projectId);
      await assertCanViewTopicTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        data.map((topic) => topic.id),
      );
      return { data, success: true };
    }),
  attachEnvironment: write
    .input(z.object({ projectId: z.string(), environmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.directoryModel.attachEnvironment(input.projectId, input.environmentId),
      success: true,
    })),
  listEnvironments: procedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.directoryModel.listEnvironments(input.projectId),
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
      data: await ctx.directoryModel.saveEnvironment(input),
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
      return { data: await ctx.directoryModel.bind(input), success: true };
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
        data: await ctx.directoryModel.startTopic(input.id, input.agentId, input.title),
        success: true,
      };
    }),
});
