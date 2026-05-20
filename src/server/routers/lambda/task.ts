import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { TaskListItem, TaskParticipant } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TaskService } from '@/server/services/task';
import { TaskRunnerService } from '@/server/services/taskRunner';

const taskProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId),
      taskService: new TaskService(ctx.serverDB, ctx.userId),
      taskTopicModel: new TaskTopicModel(ctx.serverDB, ctx.userId),
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
  // Optional schedule wiring at create time. When `automationMode` is
  // 'schedule', `schedulePattern` (cron) is required for the central
  // schedule-dispatch sweep to pick the task up.
  automationMode: z.enum(['heartbeat', 'schedule']).optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  identifierPrefix: z.string().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
  schedulePattern: z.string().optional(),
  scheduleTimezone: z.string().optional(),
});

const updateSchema = z.object({
  assigneeAgentId: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  automationMode: z.enum(['heartbeat', 'schedule']).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  // 0 clears the interval (disables heartbeat); any positive value must be
  // ≥600s (10 min) to match the UI minimum and prevent sub-minute ticks if an
  // LLM calls setTaskSchedule with a tiny number.
  heartbeatInterval: z
    .number()
    .int()
    .refine((v) => v === 0 || v >= 600, {
      message: 'heartbeatInterval must be 0 (disabled) or at least 600 seconds (10 minutes)',
    })
    .optional(),
  heartbeatTimeout: z.number().min(1).nullable().optional(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  priority: z.number().min(0).max(4).optional(),
  schedulePattern: z.string().nullable().optional(),
  scheduleTimezone: z.string().nullable().optional(),
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

// Helper: resolve id/identifier and throw if not found
async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

async function assertAssigneeAgentBelongsToUser(
  model: AgentModel,
  assigneeAgentId?: string | null,
) {
  if (!assigneeAgentId) return;

  const exists = await model.existsById(assigneeAgentId);
  if (!exists) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Assignee agent not found',
    });
  }
}

async function resolveSafeParentTaskId(
  model: TaskModel,
  taskId: string,
  parentTaskId: string | null,
): Promise<string | null> {
  if (parentTaskId === null) return null;

  const parent = await resolveOrThrow(model, parentTaskId);
  if (parent.id === taskId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to itself',
    });
  }

  const descendants = await model.findAllDescendants(taskId);
  if (descendants.some((task) => task.id === parent.id)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to its own descendant',
    });
  }

  return parent.id;
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
        authorAgentId: z.string().optional(),
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
        await assertAssigneeAgentBelongsToUser(ctx.agentModel, input.authorAgentId);
        const comment = await model.addComment({
          authorAgentId: input.authorAgentId,
          authorUserId: input.authorAgentId ? undefined : ctx.userId,
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
        await ctx.taskService.cancelTopic(input.topicId);
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
        await ctx.taskService.deleteTopic(input.topicId);
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
      const task = await ctx.taskService.createTask(input);
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
          trigger: 'task',
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
      try {
        const runner = new TaskRunnerService(ctx.serverDB, ctx.userId);
        return await runner.runTask({
          continueTopicId: input.continueTopicId,
          extraPrompt: input.prompt,
          taskId: input.id,
        });
      } catch (error) {
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
        const result = await ctx.taskService.runReview(input);
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
    const { id, parentTaskId, ...data } = input;
    try {
      const model = ctx.taskModel;
      await assertAssigneeAgentBelongsToUser(ctx.agentModel, data.assigneeAgentId);
      const resolved = await resolveOrThrow(model, id);
      const resolvedParentTaskId =
        parentTaskId === undefined
          ? undefined
          : await resolveSafeParentTaskId(model, resolved.id, parentTaskId);
      const updateData =
        parentTaskId === undefined ? data : { ...data, parentTaskId: resolvedParentTaskId };
      const task = await model.update(resolved.id, updateData);
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

  previewSubtaskLayers: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const plan = await ctx.taskService.previewSubtaskLayers(input.id);
      return { data: plan, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:previewSubtaskLayers]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to plan subtask layers',
      });
    }
  }),

  runReadySubtasks: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const result = await ctx.taskService.runReadySubtasks(input.id);
      return { data: result, success: result.failed.length === 0 };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:runReadySubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to run subtasks',
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
      try {
        const result = await ctx.taskService.updateStatus(input);
        const { task, unlocked, paused, checkpointTriggered, allSubtasksDone, parentTaskId } =
          result;
        return {
          data: task,
          message: `Task ${input.status}`,
          success: true,
          ...(unlocked.length > 0 && { unlocked }),
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId }),
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
