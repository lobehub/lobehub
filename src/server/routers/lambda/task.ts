import { TaskIdentifier as TaskSkillIdentifier } from '@lobechat/builtin-skills';
import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { buildTaskRunPrompt } from '@lobechat/prompts';
import type {
  TaskListItem,
  TaskParticipant,
  TaskTopicHandoff,
  WorkspaceData,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AiAgentService } from '@/server/services/aiAgent';
import { TaskService } from '@/server/services/task';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { TaskReviewService } from '@/server/services/taskReview';

const taskProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      briefModel: new BriefModel(ctx.serverDB, ctx.userId),
      taskLifecycle: new TaskLifecycleService(ctx.serverDB, ctx.userId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId),
      taskService: new TaskService(ctx.serverDB, ctx.userId),
      taskTopicModel: new TaskTopicModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

// All procedures that take an id accept either raw id (task_xxx) or identifier (TASK-1)
// Resolution happens in the model layer via model.resolve()
const idInput = z.object({ id: z.string() });

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
const createSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  identifierPrefix: z.string().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
});

const updateSchema = z.object({
  assigneeAgentId: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  automationMode: z.enum(['heartbeat', 'schedule']).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  heartbeatInterval: z.number().min(0).optional(),
  heartbeatTimeout: z.number().min(1).nullable().optional(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
});

const listSchema = z.object({
  assigneeAgentId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  parentIdentifier: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  priorities: z.array(z.number().min(0).max(4)).max(5).optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).max(10).optional(),
});

const groupListSchema = z.object({
  assigneeAgentId: z.string().optional(),
  groups: z
    .array(
      z.object({
        key: z.string(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        statuses: z.array(z.string()).min(1).max(10),
      }),
    )
    .min(1)
    .max(10),
  parentTaskId: z.string().nullable().optional(),
});

// Helper: build task prompt with handoff context from previous topics
async function buildTaskPrompt(
  task: Awaited<ReturnType<TaskModel['findById']>> & {},
  ctx: {
    briefModel: BriefModel;
    taskModel: TaskModel;
    taskTopicModel: TaskTopicModel;
  },
  extraPrompt?: string,
): Promise<string> {
  const { briefModel, taskModel, taskTopicModel } = ctx;

  const [topics, briefs, comments, subtasks, dependencies, documents] = await Promise.all([
    task.totalTopics && task.totalTopics > 0
      ? taskTopicModel.findWithHandoff(task.id).catch(() => [])
      : Promise.resolve([]),
    briefModel.findByTaskId(task.id).catch(() => []),
    taskModel.getComments(task.id).catch(() => []),
    taskModel.findSubtasks(task.id).catch(() => []),
    taskModel.getDependencies(task.id).catch(() => []),
    taskModel
      .getTreePinnedDocuments(task.id)
      .catch((): WorkspaceData => ({ nodeMap: {}, tree: [] })),
  ]);

  // Batch-fetch dependencies for all subtasks to show blockedBy info
  const subtaskIds = subtasks.map((s: any) => s.id);
  const subtaskDeps =
    subtaskIds.length > 0
      ? await taskModel.getDependenciesByTaskIds(subtaskIds).catch(() => [])
      : [];
  // Build a map: subtaskId -> dependsOn identifier
  const subtaskIdToIdentifier = new Map(subtasks.map((s: any) => [s.id, s.identifier]));
  const subtaskDepMap = new Map<string, string>();
  for (const dep of subtaskDeps as any[]) {
    const depIdentifier = subtaskIdToIdentifier.get(dep.dependsOnId);
    if (depIdentifier) subtaskDepMap.set(dep.taskId, depIdentifier);
  }

  // Resolve dependency task identifiers
  const depTaskIds = [...new Set(dependencies.map((d: any) => d.dependsOnId))];
  const depTasks = await taskModel.findByIds(depTaskIds);
  const depIdToIdentifier = new Map(depTasks.map((t: any) => [t.id, t.identifier]));

  // Resolve parent task context (identifier + sibling subtasks)
  let parentIdentifier: string | null = null;
  let parentTaskContext:
    | {
        identifier: string;
        instruction: string;
        name?: string | null;
        subtasks?: Array<{
          blockedBy?: string;
          identifier: string;
          name?: string | null;
          priority?: number | null;
          status: string;
        }>;
      }
    | undefined;

  if (task.parentTaskId) {
    const parent = await taskModel.findById(task.parentTaskId);
    parentIdentifier = parent?.identifier || null;
    if (parent) {
      const siblings = await taskModel.findSubtasks(task.parentTaskId).catch(() => []);
      const siblingIds = siblings.map((s: any) => s.id);
      const siblingDeps =
        siblingIds.length > 0
          ? await taskModel.getDependenciesByTaskIds(siblingIds).catch(() => [])
          : [];
      const siblingIdToIdentifier = new Map(siblings.map((s: any) => [s.id, s.identifier]));
      const siblingDepMap = new Map<string, string>();
      for (const dep of siblingDeps as any[]) {
        const depId = siblingIdToIdentifier.get(dep.dependsOnId);
        if (depId) siblingDepMap.set(dep.taskId, depId);
      }

      parentTaskContext = {
        identifier: parent.identifier,
        instruction: parent.instruction,
        name: parent.name,
        subtasks: siblings.map((s: any) => ({
          blockedBy: siblingDepMap.get(s.id),
          identifier: s.identifier,
          name: s.name,
          priority: s.priority,
          status: s.status,
        })),
      };
    }
  }

  return buildTaskRunPrompt({
    activities: {
      briefs: briefs.map((b: any) => ({
        createdAt: b.createdAt,
        id: b.id,
        priority: b.priority,
        resolvedAction: b.resolvedAction,
        resolvedAt: b.resolvedAt,
        resolvedComment: b.resolvedComment,
        summary: b.summary,
        title: b.title,
        type: b.type,
      })),
      comments: comments.map((c: any) => ({
        agentId: c.authorAgentId,
        content: c.content,
        createdAt: c.createdAt,
        id: c.id,
      })),
      subtasks: subtasks.map((s: any) => ({
        createdAt: s.createdAt,
        id: s.id,
        identifier: s.identifier,
        name: s.name,
        status: s.status,
      })),
      topics: (topics as any[]).map((t) => {
        const handoff = t.handoff as TaskTopicHandoff | null;
        return {
          createdAt: t.createdAt,
          handoff,
          id: t.topicId || t.id,
          seq: t.seq,
          status: t.status,
          title: handoff?.title || t.title,
        };
      }),
    },
    extraPrompt,
    parentTask: parentTaskContext,
    task: {
      assigneeAgentId: task.assigneeAgentId,
      dependencies: dependencies.map((d: any) => ({
        dependsOn: depIdToIdentifier.get(d.dependsOnId) ?? d.dependsOnId,
        type: d.type,
      })),
      description: task.description,
      id: task.id,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
      parentIdentifier,
      priority: task.priority,
      review: taskModel.getReviewConfig(task) as any,
      status: task.status,
      subtasks: subtasks.map((s: any) => ({
        blockedBy: subtaskDepMap.get(s.id),
        identifier: s.identifier,
        name: s.name,
        priority: s.priority,
        status: s.status,
      })),
    },
    workspace: documents.tree.map((rootNode) => {
      const rootDoc = documents.nodeMap[rootNode.id];
      return {
        children: rootNode.children.map((child) => {
          const childDoc = documents.nodeMap[child.id];
          return {
            createdAt: childDoc?.createdAt,
            documentId: child.id,
            size: childDoc?.charCount ?? undefined,
            sourceTaskIdentifier: childDoc?.sourceTaskIdentifier ?? undefined,
            title: childDoc?.title,
          };
        }),
        createdAt: rootDoc?.createdAt,
        documentId: rootNode.id,
        title: rootDoc?.title,
      };
    }),
  });
}

// Helper: resolve id/identifier and throw if not found
async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

export const taskRouter = router({
  reorderSubtasks: taskProcedure
    .input(
      z.object({
        id: z.string(),
        // Ordered list of subtask identifiers (e.g. ['TASK-2', 'TASK-4', 'TASK-3'])
        order: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
        const subtasks = await model.findSubtasks(task.id);

        // Build identifier → id map
        const idMap = new Map<string, string>();
        for (const s of subtasks) idMap.set(s.identifier, s.id);

        // Validate all identifiers exist
        const reorderItems: Array<{ id: string; sortOrder: number }> = [];
        for (let i = 0; i < input.order.length; i++) {
          const identifier = input.order[i].toUpperCase();
          const taskId = idMap.get(identifier);
          if (!taskId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Subtask not found: ${identifier}`,
            });
          }
          reorderItems.push({ id: taskId, sortOrder: i });
        }

        await model.reorder(reorderItems);

        return {
          data: reorderItems.map((item, i) => ({
            identifier: input.order[i],
            sortOrder: item.sortOrder,
          })),
          message: 'Subtasks reordered',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:reorderSubtasks]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reorder subtasks',
        });
      }
    }),

  addComment: taskProcedure
    .input(
      z.object({
        briefId: z.string().optional(),
        content: z.string().min(1),
        id: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
        const comment = await model.addComment({
          authorUserId: ctx.userId,
          briefId: input.briefId,
          content: input.content,
          taskId: task.id,
          topicId: input.topicId,
          userId: ctx.userId,
        });
        return { data: comment, message: 'Comment added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add comment',
        });
      }
    }),

  deleteComment: taskProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const deleted = await ctx.taskModel.deleteComment(input.commentId);
        if (!deleted) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { message: 'Comment deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete comment',
        });
      }
    }),

  updateComment: taskProcedure
    .input(z.object({ commentId: z.string(), content: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const comment = await ctx.taskModel.updateComment(input.commentId, input.content);
        if (!comment) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { data: comment, message: 'Comment updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update comment',
        });
      }
    }),

  addDependency: taskProcedure
    .input(
      z.object({
        dependsOnId: z.string(),
        taskId: z.string(),
        type: z.enum(['blocks', 'relates']).default('blocks'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.addDependency(task.id, dep.id, input.type);
        return { message: 'Dependency added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add dependency',
        });
      }
    }),

  cancelTopic: taskProcedure
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const target = await ctx.taskTopicModel.findByTopicId(input.topicId);
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found.' });
        }

        if (target.status !== 'running') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Topic is not running (current status: ${target.status}).`,
          });
        }

        if (target.operationId) {
          const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
          await aiAgentService.interruptTask({ operationId: target.operationId });
        }

        await ctx.taskTopicModel.updateStatus(target.taskId, input.topicId, 'canceled');
        await ctx.taskModel.updateStatus(target.taskId, 'paused');

        return { message: 'Topic canceled', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:cancelTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel topic',
        });
      }
    }),

  deleteTopic: taskProcedure
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const target = await ctx.taskTopicModel.findByTopicId(input.topicId);
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found.' });
        }

        if (target.status === 'running' && target.operationId) {
          const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
          await aiAgentService.interruptTask({ operationId: target.operationId });
        }

        await ctx.taskTopicModel.remove(target.taskId, input.topicId);
        await ctx.topicModel.delete(input.topicId);

        return { message: 'Topic deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete topic',
        });
      }
    }),

  create: taskProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;

      // Resolve parentTaskId if it's an identifier
      const createData = { ...input };
      if (createData.parentTaskId) {
        const parent = await resolveOrThrow(model, createData.parentTaskId);
        createData.parentTaskId = parent.id;
      }

      const task = await model.create(createData);
      return { data: task, message: 'Task created', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:create]', error);
      const causeMessage = error instanceof Error ? error.message : String(error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: causeMessage ? `Failed to create task: ${causeMessage}` : 'Failed to create task',
      });
    }
  }),

  clearAll: taskProcedure.mutation(async ({ ctx }) => {
    try {
      const model = ctx.taskModel;
      const count = await model.deleteAll();
      return { count, message: `${count} tasks deleted`, success: true };
    } catch (error) {
      console.error('[task:clearAll]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to clear tasks',
      });
    }
  }),

  delete: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.delete(task.id);
      return { data: task, message: 'Task deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete task',
      });
    }
  }),

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

  heartbeat: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.updateHeartbeat(task.id);
      return { message: 'Heartbeat updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:heartbeat]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update heartbeat',
      });
    }
  }),

  watchdog: taskProcedure.mutation(async ({ ctx }) => {
    try {
      const stuckTasks = await TaskModel.findStuckTasks(ctx.serverDB);
      const failed: string[] = [];

      for (const task of stuckTasks) {
        const model = new TaskModel(ctx.serverDB, task.createdByUserId);
        await model.updateStatus(task.id, 'failed', {
          completedAt: new Date(),
          error: 'Heartbeat timeout',
        });

        // Create error brief
        const briefModel = new BriefModel(ctx.serverDB, task.createdByUserId);
        await briefModel.create({
          agentId: task.assigneeAgentId || undefined,
          priority: 'urgent',
          summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
          taskId: task.id,
          title: `${task.identifier} heartbeat timeout`,
          type: 'error',
        });

        failed.push(task.identifier);
      }

      return {
        checked: stuckTasks.length,
        failed,
        message:
          failed.length > 0
            ? `${failed.length} stuck tasks marked as failed`
            : 'No stuck tasks found',
        success: true,
      };
    } catch (error) {
      console.error('[task:watchdog]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Watchdog check failed',
      });
    }
  }),

  groupList: taskProcedure.input(groupListSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const groups = await model.groupList(input);
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
      const { parentIdentifier, ...query } = input;
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
        parentTaskId,
      });

      const assigneeIds = [
        ...new Set(result.tasks.map((t) => t.assigneeAgentId).filter((id): id is string => !!id)),
      ];
      const agents =
        assigneeIds.length > 0 ? await ctx.agentModel.getAgentAvatarsByIds(assigneeIds) : [];
      const agentMap = new Map(agents.map((a) => [a.id, a]));

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

  run: taskProcedure
    .input(
      idInput.merge(
        z.object({
          continueTopicId: z.string().optional(),
          prompt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, prompt: extraPrompt, continueTopicId } = input;
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, id);

        // Ensure task has an assigned agent
        if (!task.assigneeAgentId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Task has no assigned agent. Use --agent when creating or edit the task.',
          });
        }

        // Idempotency checks
        const existingTopics = await ctx.taskTopicModel.findByTaskId(task.id);

        if (continueTopicId) {
          // If continuing a topic that's already running, reject
          const target = existingTopics.find((t) => t.topicId === continueTopicId);
          if (target?.status === 'running') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Topic ${continueTopicId} is already running.`,
            });
          }
        } else {
          // If there's already a running topic, reject creating a new one
          const runningTopic = existingTopics.find((t) => t.status === 'running');
          if (runningTopic) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Task already has a running topic (${runningTopic.topicId}). Cancel it first or use --continue.`,
            });
          }
        }

        // Auto-detect and clean up timed-out topics
        if (task.lastHeartbeatAt && task.heartbeatTimeout) {
          const elapsed = (Date.now() - new Date(task.lastHeartbeatAt).getTime()) / 1000;
          if (elapsed > task.heartbeatTimeout) {
            await ctx.taskTopicModel.timeoutRunning(task.id);
          }
        }

        // Build prompt with handoff context from previous topics
        const prompt = await buildTaskPrompt(task, ctx, extraPrompt);

        // Update task status to running if not already, clear previous error
        if (task.status !== 'running') {
          await model.updateStatus(task.id, 'running', { error: null, startedAt: new Date() });
        } else if (task.error) {
          await model.update(task.id, { error: null });
        }

        // Call AiAgentService.execAgent
        // assigneeAgentId can be either a raw agentId (agt_xxx) or a slug (inbox)
        const agentRef = task.assigneeAgentId!;
        const isSlug = !agentRef.startsWith('agt_');

        const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
        const taskId = task.id;
        const taskIdentifier = task.identifier;
        const { taskLifecycle } = ctx;
        const db = ctx.serverDB;
        const userId = ctx.userId;

        // Task execution auto-injects the Task skill. The legacy Notebook tool
        // has been deprecated and is no longer injected — document output now
        // flows through the agent-documents tool, which is enabled via the
        // agent config (see INBOX runtime / createEnableChecker).
        // Conditionally inject Brief tool based on checkpoint/review config.
        const checkpoint = model.getCheckpointConfig(task);
        const reviewConfig = model.getReviewConfig(task);
        const pluginIds = [TaskSkillIdentifier];
        if (!reviewConfig?.enabled && checkpoint.onAgentRequest !== false) {
          pluginIds.push(BriefIdentifier);
        }

        // Read per-task model/provider overrides from task.config
        const taskConfig = (task.config ?? {}) as Record<string, unknown>;

        const result = await aiAgentService.execAgent({
          ...(isSlug ? { slug: agentRef } : { agentId: agentRef }),
          additionalPluginIds: pluginIds,
          ...(typeof taskConfig.model === 'string' && { model: taskConfig.model }),
          ...(typeof taskConfig.provider === 'string' && { provider: taskConfig.provider }),
          hooks: [
            {
              handler: async (event) => {
                await taskLifecycle.onTopicComplete({
                  errorMessage: event.errorMessage,
                  lastAssistantContent: event.lastAssistantContent,
                  operationId: event.operationId,
                  reason: event.reason || 'done',
                  taskId,
                  taskIdentifier,
                  topicId: event.topicId,
                });
              },
              id: 'task-on-complete',
              type: 'onComplete' as const,
              webhook: {
                body: { taskId, taskIdentifier, userId },
                url: '/api/workflows/task/on-topic-complete',
              },
            },
          ],
          prompt,
          taskId: task.id,
          title: extraPrompt ? extraPrompt.slice(0, 100) : task.name || task.identifier,
          trigger: 'task',
          userInterventionConfig: { approvalMode: 'headless' },
          // Continue on existing topic if specified
          ...(continueTopicId && { appContext: { topicId: continueTopicId } }),
        });

        // Update task topic count, current topic, and association
        if (result.topicId) {
          if (continueTopicId) {
            // Continuing existing topic — update status and operationId
            await ctx.taskTopicModel.updateStatus(task.id, continueTopicId, 'running');
            await ctx.taskTopicModel.updateOperationId(
              task.id,
              continueTopicId,
              result.operationId,
            );
            await model.updateCurrentTopic(task.id, continueTopicId);
          } else {
            // New topic
            await model.incrementTopicCount(task.id);
            await model.updateCurrentTopic(task.id, result.topicId);
            await ctx.taskTopicModel.add(task.id, result.topicId, {
              operationId: result.operationId,
              seq: (task.totalTopics || 0) + 1,
            });
          }
        }

        // Update heartbeat
        await model.updateHeartbeat(task.id);

        return {
          ...result,
          taskId: task.id,
          taskIdentifier: task.identifier,
        };
      } catch (error) {
        // Rollback task status to paused on failure
        try {
          const model = ctx.taskModel;
          const failedTask = await model.resolve(id);
          if (failedTask && failedTask.status === 'running') {
            await model.updateStatus(failedTask.id, 'paused', {
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        } catch {
          // Rollback itself failed, ignore
        }

        if (error instanceof TRPCError) throw error;
        console.error('[task:run]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run task',
        });
      }
    }),

  pinDocument: taskProcedure
    .input(
      z.object({
        documentId: z.string(),
        pinnedBy: z.string().default('user'),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        await model.pinDocument(task.id, input.documentId, input.pinnedBy);
        return { message: 'Document pinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:pinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to pin document',
        });
      }
    }),

  removeDependency: taskProcedure
    .input(z.object({ dependsOnId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.removeDependency(task.id, dep.id);
        return { message: 'Dependency removed', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:removeDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove dependency',
        });
      }
    }),

  unpinDocument: taskProcedure
    .input(z.object({ documentId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        await model.unpinDocument(task.id, input.documentId);
        return { message: 'Document unpinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:unpinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to unpin document',
        });
      }
    }),

  getCheckpoint: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const checkpoint = model.getCheckpointConfig(task);
      return { data: checkpoint, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getCheckpoint]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get checkpoint',
      });
    }
  }),

  updateCheckpoint: taskProcedure
    .input(
      idInput.merge(
        z.object({
          checkpoint: z.object({
            onAgentRequest: z.boolean().optional(),
            tasks: z
              .object({
                afterIds: z.array(z.string()).optional(),
                beforeIds: z.array(z.string()).optional(),
              })
              .optional(),
            topic: z
              .object({
                after: z.boolean().optional(),
                before: z.boolean().optional(),
              })
              .optional(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, checkpoint } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateCheckpointConfig(resolved.id, checkpoint);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getCheckpointConfig(task),
          message: 'Checkpoint updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateCheckpoint]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update checkpoint',
        });
      }
    }),

  getReview: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: model.getReviewConfig(task) || null, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getReview]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get review config',
      });
    }
  }),

  updateReview: taskProcedure
    .input(
      idInput.merge(
        z.object({
          review: z.object({
            autoRetry: z.boolean().default(true),
            enabled: z.boolean(),
            judge: z
              .object({
                model: z.string().optional(),
                provider: z.string().optional(),
              })
              .default({}),
            maxIterations: z.number().min(1).max(10).default(3),
            rubrics: z.array(
              z.object({
                config: z.record(z.unknown()),
                extractor: z.record(z.unknown()).optional(),
                id: z.string(),
                name: z.string(),
                threshold: z.number().min(0).max(1).optional(),
                type: z.string(),
                weight: z.number().default(1),
              }),
            ),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, review } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateReviewConfig(resolved.id, review);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getReviewConfig(task),
          message: 'Review config updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update review config',
        });
      }
    }),

  runReview: taskProcedure
    .input(
      idInput.merge(
        z.object({
          content: z.string().optional(),
          topicId: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);

        const reviewConfig = model.getReviewConfig(task);
        if (!reviewConfig?.enabled) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Review is not enabled for this task',
          });
        }

        // Use provided content or try to get from latest topic
        const content = input.content;
        if (!content) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Content is required for review. Pass --content or run after a topic completes.',
          });
        }

        // Determine which topic to attach the review to
        const topicId = input.topicId || task.currentTopicId;

        // Get current iteration count for this topic
        let iteration = 1;
        if (topicId) {
          const topics = await ctx.taskTopicModel.findByTaskId(task.id);
          const target = topics.find((t) => t.topicId === topicId);
          if (target?.reviewIteration) {
            iteration = target.reviewIteration + 1;
          }
        }

        const reviewService = new TaskReviewService(ctx.serverDB, ctx.userId);
        const result = await reviewService.review({
          content,
          iteration,
          judge: reviewConfig.judge,
          rubrics: reviewConfig.rubrics,
          taskName: task.name || task.identifier,
        });

        // Save review result to task_topics
        if (topicId) {
          await ctx.taskTopicModel.updateReview(task.id, topicId, {
            iteration,
            passed: result.passed,
            score: result.overallScore,
            scores: result.rubricResults,
          });
        }

        return { data: result, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:runReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run review',
        });
      }
    }),

  update: taskProcedure.input(idInput.merge(updateSchema)).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    try {
      const model = ctx.taskModel;
      const resolved = await resolveOrThrow(model, id);
      const task = await model.update(resolved.id, data);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      return { data: task, message: 'Task updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:update]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update task',
      });
    }
  }),

  updateConfig: taskProcedure
    .input(idInput.merge(z.object({ config: z.record(z.unknown()) })))
    .mutation(async ({ input, ctx }) => {
      const { id, config } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateTaskConfig(resolved.id, config);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: task, message: 'Config updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateConfig]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task config',
        });
      }
    }),

  updateStatus: taskProcedure
    .input(
      z.object({
        error: z.string().optional(),
        id: z.string(),
        status: z.enum(TASK_STATUSES),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, status, error: errorMsg } = input;
      try {
        if (errorMsg && status !== 'failed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Task error can only be provided when status is failed.',
          });
        }

        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);

        // Cascade: when leaving `running`, cancel all running topics
        if (resolved.status === 'running' && status !== 'running') {
          const topics = await ctx.taskTopicModel.findByTaskId(resolved.id);
          const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);

          for (const t of topics) {
            if (t.status !== 'running' || !t.topicId) continue;

            // Interrupt the remote operation first; if it fails, skip cancellation
            // to avoid desynchronizing DB state from a still-running operation.
            if (t.operationId) {
              try {
                await aiAgentService.interruptTask({ operationId: t.operationId });
              } catch (err) {
                console.error('[task:updateStatus] failed to interrupt topic %s:', t.topicId, err);
                continue;
              }
            }

            // Conditionally cancel only if the topic is still running,
            // avoiding overwrite of a concurrent completed/timeout transition.
            await ctx.taskTopicModel.cancelIfRunning(resolved.id, t.topicId);
          }
        }

        const extra: Record<string, unknown> = {};
        if (status === 'running') extra.startedAt = new Date();
        if (status === 'completed' || status === 'failed' || status === 'canceled')
          extra.completedAt = new Date();
        if (errorMsg) extra.error = errorMsg;

        const task = await model.updateStatus(resolved.id, status, extra);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

        // On completion: check dependency unlocking + parent notification + checkpoints
        const unlocked: string[] = [];
        const paused: string[] = [];
        let allSubtasksDone = false;
        let checkpointTriggered = false;

        if (status === 'completed') {
          // 1. Check afterIds checkpoint on parent
          if (task.parentTaskId) {
            const parentTask = await model.findById(task.parentTaskId);
            if (parentTask && model.shouldPauseAfterComplete(parentTask, task.identifier)) {
              // Pause the parent task for review
              await model.updateStatus(parentTask.id, 'paused');
              checkpointTriggered = true;
            }

            // 2. Check if all sibling subtasks are done
            allSubtasksDone = await model.areAllSubtasksCompleted(task.parentTaskId);
          }

          // 3. Unlock tasks blocked by this one
          const unlockedTasks = await model.getUnlockedTasks(task.id);
          for (const ut of unlockedTasks) {
            // Check beforeIds checkpoint on parent before starting
            let shouldPause = false;
            if (ut.parentTaskId) {
              const parentTask = await model.findById(ut.parentTaskId);
              if (parentTask && model.shouldPauseBeforeStart(parentTask, ut.identifier)) {
                shouldPause = true;
              }
            }

            if (shouldPause) {
              await model.updateStatus(ut.id, 'paused');
              paused.push(ut.identifier);
            } else {
              await model.updateStatus(ut.id, 'running', { startedAt: new Date() });
              unlocked.push(ut.identifier);
            }
          }
        }

        return {
          data: task,
          message: `Task ${status}`,
          success: true,
          ...(unlocked.length > 0 && { unlocked }),
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId: task.parentTaskId }),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update status',
        });
      }
    }),
});
