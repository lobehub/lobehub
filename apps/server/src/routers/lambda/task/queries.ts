import type { TaskListItem, TaskParticipant } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { UserModel } from '@/database/models/user';
import { router } from '@/libs/trpc/lambda';

import { groupListSchema, listSchema, resolveClosedAfter } from '../_helpers/taskListSchemas';
import { idInput, resolveOrThrow, taskProcedure } from './procedures';

export const queriesRouter = router({
  detail: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const detail = await ctx.taskService.getTaskDetail(input.id);
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { data: detail, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:detail]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task detail',
      });
    }
  }),
  find: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: task, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find task',
      });
    }
  }),
  getDependencies: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const deps = await model.getDependencies(task.id);
      return { data: deps, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getDependencies]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get dependencies',
      });
    }
  }),
  getPinnedDocuments: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const docs = await model.getPinnedDocuments(task.id);
      return { data: docs, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getPinnedDocuments]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get documents',
      });
    }
  }),
  getTopics: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const results = await ctx.taskTopicModel.findWithDetails(task.id);
      return { data: results, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTopics]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task topics',
      });
    }
  }),
  getSubtasks: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const subtasks = await model.findSubtasks(task.id);
      return { data: subtasks, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getSubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get subtasks',
      });
    }
  }),
  getTaskTree: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const tree = await model.getTaskTree(task.id);
      return { data: tree, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTaskTree]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task tree',
      });
    }
  }),
  groupList: taskProcedure.input(groupListSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const { completedWithin, scope, ...query } = input;
      const groups = await model.groupList({
        ...query,
        closedAfter: resolveClosedAfter(completedWithin),
        ...(scope === 'assigned' ? { assigneeUserId: ctx.userId } : {}),
        ...(scope === 'created' ? { createdByUserId: ctx.userId } : {}),
      });
      return { data: groups, success: true };
    } catch (error) {
      console.error('[task:groupList]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch grouped tasks',
      });
    }
  }),
  list: taskProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const { completedWithin, parentIdentifier, scope, ...query } = input;
      let parentTaskId = query.parentTaskId;

      if (parentIdentifier) {
        const parent = await model.resolve(parentIdentifier);
        if (!parent) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Parent task not found: ${parentIdentifier}`,
          });
        }

        parentTaskId = parent.id;
      }

      const result = await model.list({
        ...query,
        closedAfter: resolveClosedAfter(completedWithin),
        ...(scope === 'assigned' ? { assigneeUserId: ctx.userId } : {}),
        ...(scope === 'created' ? { createdByUserId: ctx.userId } : {}),
        parentTaskId,
      });

      const assigneeIds = [
        ...new Set(result.tasks.map((t) => t.assigneeAgentId).filter((id): id is string => !!id)),
      ];
      const assigneeUserIds = [
        ...new Set(result.tasks.map((t) => t.assigneeUserId).filter((id): id is string => !!id)),
      ];
      const [agents, users] = await Promise.all([
        assigneeIds.length > 0 ? ctx.agentModel.getAgentAvatarsByIds(assigneeIds) : [],
        assigneeUserIds.length > 0
          ? UserModel.getDisplayInfoByIds(ctx.serverDB, assigneeUserIds)
          : [],
      ]);
      const agentMap = new Map(agents.map((a) => [a.id, a]));
      const userMap = new Map(users.map((u) => [u.id, u]));

      const data: TaskListItem[] = result.tasks.map((task) => {
        const participants: TaskParticipant[] = [];
        if (task.assigneeAgentId) {
          const agent = agentMap.get(task.assigneeAgentId);
          if (agent) {
            participants.push({
              avatar: agent.avatar,
              backgroundColor: agent.backgroundColor,
              id: agent.id,
              title: agent.title ?? '',
              type: 'agent',
            });
          }
        }
        if (task.assigneeUserId) {
          const user = userMap.get(task.assigneeUserId);
          if (user) {
            participants.push({
              avatar: user.avatar,
              backgroundColor: null,
              id: user.id,
              title: user.fullName ?? user.username ?? '',
              type: 'user',
            });
          }
        }
        return { ...task, participants };
      });

      return { data, success: true, total: result.total };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list tasks',
      });
    }
  }),
  usage: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const task = await resolveOrThrow(ctx.taskModel, input.id);
      const usage = await ctx.taskTopicModel.sumRunCostByTaskIds([task.id]);

      return {
        data: { ...usage, taskId: task.id, taskIdentifier: task.identifier },
        success: true,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:usage]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task usage',
      });
    }
  }),
});
