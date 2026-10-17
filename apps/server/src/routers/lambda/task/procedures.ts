import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { EditLockService } from '@/server/services/editLock';
import { TaskService } from '@/server/services/task';
import { TaskIntentService } from '@/server/services/task/intent';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

export const taskProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      briefModel: new BriefModel(ctx.serverDB, ctx.userId, wsId),
      editLockService: new EditLockService(ctx.userId),
      taskLifecycle: new TaskLifecycleService(ctx.serverDB, ctx.userId, wsId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId, wsId),
      taskIntentService: new TaskIntentService(ctx.serverDB, ctx.userId, wsId),
      taskService: new TaskService(ctx.serverDB, ctx.userId, wsId),
      taskTopicModel: new TaskTopicModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Write variant gates viewers out of every task mutation (create/update/delete/
// run). Reads keep using `taskProcedure` so viewers can still inspect tasks
// and their status.
export const taskProcedureWrite = taskProcedure.use(withScopedPermission('agent:update'));

// All procedures that take an id accept either raw id (task_xxx) or identifier (TASK-1)
// Resolution happens in the model layer via model.resolve()
export const idInput = z.object({ id: z.string() });

export const taskVerifyConfigPatchSchema = z.object({
  enabled: z.boolean().nullish(),
  maxIterations: z.number().min(1).max(10).nullish(),
  requirement: z.string().nullish(),
  verifierAgentId: z.string().nullish(),
  verifyCriteriaIds: z.array(z.string()).nullish(),
  verifyRubricId: z.string().nullish(),
});

// Helper: resolve id/identifier and throw if not found
export async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}
