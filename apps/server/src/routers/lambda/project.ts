import { PROJECT_IDENTIFIER_REGEX, PROJECT_STATUSES, PROJECT_VISIBILITIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ProjectModel } from '@/database/models/project';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const projectProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      projectModel: new ProjectModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});

const projectWriteProcedure = projectProcedure.use(withScopedPermission('agent:update'));
const idInput = z.object({ id: z.string() });
const projectIdentifierInput = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(PROJECT_IDENTIFIER_REGEX, 'Invalid project identifier'));

function requireResult<T>(result: T | null, message = 'Project not found'): T {
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message });
  return result;
}

function mapProjectError(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  const message = error instanceof Error ? error.message : `Failed to ${operation} project`;
  console.error(`[project:${operation}]`, error);
  throw new TRPCError({ cause: error, code: 'BAD_REQUEST', message });
}

export const projectRouter = router({
  acceptCompletion: projectWriteProcedure
    .input(idInput.extend({ comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          data: requireResult(
            await ctx.projectModel.reviewCompletion(input.id, 'accepted', input.comment),
          ),
          message: 'Project completion accepted',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'acceptCompletion');
      }
    }),

  addAgent: projectWriteProcedure
    .input(
      idInput.extend({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        responsibility: z.string().nullish(),
        role: z.string().nullish(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: requireResult(await ctx.projectModel.addAgent(id, input)),
          message: 'Agent added to project',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'addAgent');
      }
    }),

  addKnowledgeBase: projectWriteProcedure
    .input(
      idInput.extend({
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: requireResult(await ctx.projectModel.addKnowledgeBase(id, input)),
          message: 'Knowledge base added to project',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'addKnowledgeBase');
      }
    }),

  create: projectWriteProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        identifier: projectIdentifierInput,
        name: z.string().min(1).max(255),
        slug: z.string().max(100).optional(),
        visibility: z.enum(PROJECT_VISIBILITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          data: await ctx.projectModel.create(input),
          message: 'Project created',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'create');
      }
    }),

  delete: projectWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return {
        data: requireResult(await ctx.projectModel.delete(input.id)),
        message: 'Project deleted',
        success: true,
      };
    } catch (error) {
      mapProjectError(error, 'delete');
    }
  }),

  detail: projectProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      const project = requireResult(await ctx.projectModel.findById(input.id));
      const [agents, completionReviews, knowledgeBases, tasks] = await Promise.all([
        ctx.projectModel.listAgents(project.id),
        ctx.projectModel.listCompletionReviews(project.id),
        ctx.projectModel.listKnowledgeBases(project.id),
        ctx.projectModel.listTasks(project.id),
      ]);
      return {
        data: { agents, completionReviews, knowledgeBases, project, tasks },
        success: true,
      };
    } catch (error) {
      mapProjectError(error, 'detail');
    }
  }),

  find: projectProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return { data: requireResult(await ctx.projectModel.findById(input.id)), success: true };
    } catch (error) {
      mapProjectError(error, 'find');
    }
  }),

  list: projectProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        statuses: z.array(z.enum(PROJECT_STATUSES)).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return { data: await ctx.projectModel.list(input), success: true };
      } catch (error) {
        mapProjectError(error, 'list');
      }
    }),

  listCompletionReviews: projectProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return {
        data: requireResult(await ctx.projectModel.listCompletionReviews(input.id)),
        success: true,
      };
    } catch (error) {
      mapProjectError(error, 'listCompletionReviews');
    }
  }),

  moveTask: projectWriteProcedure
    .input(idInput.extend({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const rows = requireResult(await ctx.projectModel.moveTaskTree(input.id, input.taskId));
        return { data: rows, message: `${rows.length} task(s) moved`, success: true };
      } catch (error) {
        mapProjectError(error, 'moveTask');
      }
    }),

  rejectCompletion: projectWriteProcedure
    .input(idInput.extend({ comment: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          data: requireResult(
            await ctx.projectModel.reviewCompletion(input.id, 'rejected', input.comment),
          ),
          message: 'Project completion rejected',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'rejectCompletion');
      }
    }),

  removeAgent: projectWriteProcedure
    .input(idInput.extend({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const removed = await ctx.projectModel.removeAgent(input.id, input.agentId);
        if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Binding not found' });
        return { message: 'Agent removed from project', success: true };
      } catch (error) {
        mapProjectError(error, 'removeAgent');
      }
    }),

  removeKnowledgeBase: projectWriteProcedure
    .input(idInput.extend({ knowledgeBaseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const removed = await ctx.projectModel.removeKnowledgeBase(input.id, input.knowledgeBaseId);
        if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Binding not found' });
        return { message: 'Knowledge base removed from project', success: true };
      } catch (error) {
        mapProjectError(error, 'removeKnowledgeBase');
      }
    }),

  reopen: projectWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return {
        data: requireResult(await ctx.projectModel.reopen(input.id)),
        message: 'Project reopened',
        success: true,
      };
    } catch (error) {
      mapProjectError(error, 'reopen');
    }
  }),

  requestCompletion: projectWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return {
        data: requireResult(await ctx.projectModel.requestCompletion(input.id)),
        message: 'Project completion requested',
        success: true,
      };
    } catch (error) {
      mapProjectError(error, 'requestCompletion');
    }
  }),

  update: projectWriteProcedure
    .input(
      idInput.extend({
        avatar: z.string().nullish(),
        description: z.string().nullish(),
        name: z.string().min(1).max(255).optional(),
        slug: z.string().max(100).nullish(),
        visibility: z.enum(PROJECT_VISIBILITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: requireResult(await ctx.projectModel.update(id, input)),
          message: 'Project updated',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'update');
      }
    }),

  updateStatus: projectWriteProcedure
    .input(
      idInput.extend({
        status: z.enum(PROJECT_STATUSES).exclude(['completed', 'reviewing']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          data: requireResult(await ctx.projectModel.updateStatus(input.id, input.status)),
          message: 'Project status updated',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'updateStatus');
      }
    }),
});
