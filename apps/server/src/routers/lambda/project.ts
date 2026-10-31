import { PROJECT_IDENTIFIER_REGEX, PROJECT_STATUSES, PROJECT_VISIBILITIES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  type WorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { ProjectModel, type ProjectModelOptions } from '@/database/models/project';
import { ProjectCoordinatorRepository } from '@/database/repositories/projectCoordinator';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import { rethrowDuplicateProjectField } from './_helpers/projectConstraintErrors';

/**
 * Reads `workspaceRole` as an optional context field: the cloud workspace-auth
 * override injects it, while the OSS stub leaves it absent.
 */
const isWorkspaceAdmin = (ctx: { userId: string; workspaceRole?: WorkspaceRole }) =>
  ctx.workspaceRole === 'owner' || ctx.workspaceRole === 'admin';

/** Viewers hold no `agent:update` grant, so `projectWriteProcedure` rejects them. */
const isWorkspaceViewer = (ctx: { workspaceId?: string | null; workspaceRole?: WorkspaceRole }) =>
  !!ctx.workspaceId && ctx.workspaceRole === 'viewer';

const projectProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  const options: ProjectModelOptions = {
    canManageAllMembers: isWorkspaceAdmin(ctx),
    readOnly: isWorkspaceViewer(ctx),
  };
  return opts.next({
    ctx: {
      projectCoordinatorRepo: new ProjectCoordinatorRepository(
        ctx.serverDB,
        ctx.userId,
        workspaceId,
        options,
      ),
      projectModel: new ProjectModel(ctx.serverDB, ctx.userId, workspaceId, options),
    },
  });
});

const projectWriteProcedure = projectProcedure.use(withScopedPermission('agent:update'));
const idInput = z.object({ id: z.string() });
const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const projectIdentifierInput = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(PROJECT_IDENTIFIER_REGEX, 'Invalid project identifier'));
const projectSlugInput = z.string().max(100).regex(PROJECT_SLUG_REGEX, 'Invalid project slug');

function requireResult<T>(result: T | null, message = 'Project not found'): T {
  if (!result) throw new TRPCError({ code: 'NOT_FOUND', message });
  return result;
}

/** Project rows leave the API with their main agent resolved (LobeAI when cleared). */
async function withMainAgent<T extends { coordinatorAgentId: string | null }>(
  projectModel: ProjectModel,
  project: T,
) {
  const [resolved] = await projectModel.resolveCoordinatorAgents([project]);
  return resolved;
}

/**
 * A project only references reusable resources, so binding one requires the
 * same `use` access as mounting it on an agent. Personal mode is already
 * scoped to the caller's own rows by the model.
 */
const assertResourceUsable = async (
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId?: string | null },
  resourceType: 'agent' | 'knowledgeBase',
  resourceId: string,
) => {
  if (!ctx.workspaceId) return;
  await assertCanPerformResourceAction({
    action: 'use',
    db: ctx.serverDB,
    resourceId,
    resourceType,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

const agentBindingPatch = z.object({
  enabled: z.boolean().optional(),
  responsibility: z.string().max(1000).nullish(),
  role: z.string().max(100).nullish(),
  sortOrder: z.number().int().optional(),
});

const knowledgeBaseBindingPatch = z.object({
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

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
    .input(idInput.extend({ agentId: z.string() }).merge(agentBindingPatch))
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        await assertResourceUsable(ctx, 'agent', input.agentId);
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
    .input(idInput.extend({ knowledgeBaseId: z.string() }).merge(knowledgeBaseBindingPatch))
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        await assertResourceUsable(ctx, 'knowledgeBase', input.knowledgeBaseId);
        return {
          data: requireResult(await ctx.projectModel.addKnowledgeBase(id, input)),
          message: 'Knowledge base added to project',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'addKnowledgeBase');
      }
    }),

  addWork: projectWriteProcedure
    .input(idInput.extend({ sortOrder: z.number().int().optional(), workId: z.string() }))
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: requireResult(await ctx.projectModel.addWork(id, input)),
          message: 'Work added to project',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'addWork');
      }
    }),

  create: projectWriteProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        coordinatorAgentId: z.string().optional(),
        description: z.string().optional(),
        identifier: projectIdentifierInput.optional(),
        name: z.string().min(1).max(255),
        repository: z
          .object({
            defaultBranch: z.string().max(255).optional(),
            name: z.string().trim().min(1).max(255),
            url: z.string().min(1).max(2048),
          })
          .optional(),
        slug: projectSlugInput.optional(),
        visibility: z.enum(PROJECT_VISIBILITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.coordinatorAgentId) {
          await assertResourceUsable(ctx, 'agent', input.coordinatorAgentId);
        }
        return {
          data: await withMainAgent(
            ctx.projectModel,
            await ctx.projectModel.create(input).catch(rethrowDuplicateProjectField),
          ),
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
      const project = await withMainAgent(
        ctx.projectModel,
        requireResult(await ctx.projectModel.findByReference(input.id)),
      );
      // TODO(2026-12-31): remove with `ProjectModel.joinTopicAgents`.
      await ctx.projectModel.joinTopicAgents(project.id);
      const [agents, completionReviews, knowledgeBases, tasks, works, coordinatorRetires] =
        await Promise.all([
          ctx.projectModel.listAgents(project.id),
          ctx.projectModel.listCompletionReviews(project.id),
          ctx.projectModel.listKnowledgeBases(project.id),
          ctx.projectModel.listTasks(project.id),
          ctx.projectModel.listWorks(project.id),
          ctx.projectModel.isDedicatedCoordinator(project.coordinatorAgentId, {
            exceptProjectId: project.id,
          }),
        ]);
      return {
        data: {
          agents,
          completionReviews,
          /** Replacing the main agent hands its history over and deletes it. */
          coordinatorRetiresOnReplace: coordinatorRetires,
          knowledgeBases,
          permissions: ctx.projectModel.getPermissions(project),
          project,
          tasks,
          works,
        },
        success: true,
      };
    } catch (error) {
      mapProjectError(error, 'detail');
    }
  }),

  find: projectProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return {
        data: await withMainAgent(
          ctx.projectModel,
          requireResult(await ctx.projectModel.findByReference(input.id)),
        ),
        success: true,
      };
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
        return {
          data: await ctx.projectModel.resolveCoordinatorAgents(await ctx.projectModel.list(input)),
          success: true,
        };
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

  // Keep the released API contract so old clients receive a clear business error.
  // Project moves are paused while project-scoped task numbering is redesigned.
  // Re-enabling them must also move the task's acceptances (and those of its
  // run topics): `acceptances.project_id` is copied from the task when filed,
  // unless the publisher named another project explicitly.
  moveTask: projectWriteProcedure
    .input(idInput.extend({ taskId: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Moving tasks between projects is temporarily disabled',
      });
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

  replaceCoordinator: projectWriteProcedure
    .input(idInput.extend({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertResourceUsable(ctx, 'agent', input.agentId);
        return {
          data: await withMainAgent(
            ctx.projectModel,
            requireResult(
              await ctx.projectCoordinatorRepo.replaceCoordinator(input.id, input.agentId),
            ),
          ),
          message: 'Project main agent replaced',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'replaceCoordinator');
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

  removeWork: projectWriteProcedure
    .input(idInput.extend({ workId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const removed = await ctx.projectModel.removeWork(input.id, input.workId);
        if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Binding not found' });
        return { message: 'Work removed from project', success: true };
      } catch (error) {
        mapProjectError(error, 'removeWork');
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

  /** Move one project in the scope's shared manual order, next to another project. */
  move: projectWriteProcedure
    .input(
      idInput.and(z.union([z.object({ beforeId: z.string() }), z.object({ afterId: z.string() })])),
    )
    .mutation(async ({ ctx, input: { id, ...anchor } }) => {
      try {
        await ctx.projectModel.move(id, anchor);
        return { message: 'Project moved', success: true };
      } catch (error) {
        mapProjectError(error, 'move');
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
        slug: projectSlugInput.nullish(),
        visibility: z.enum(PROJECT_VISIBILITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        if (input.visibility !== undefined) {
          const project = requireResult(await ctx.projectModel.findById(id));
          if (project.userId !== ctx.userId) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the project creator can change its visibility',
            });
          }
        }
        return {
          data: await withMainAgent(
            ctx.projectModel,
            requireResult(await ctx.projectModel.update(id, input)),
          ),
          message: 'Project updated',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'update');
      }
    }),

  updateAgent: projectWriteProcedure
    .input(idInput.extend({ agentId: z.string() }).merge(agentBindingPatch))
    .mutation(async ({ ctx, input: { agentId, id, ...patch } }) => {
      try {
        return {
          data: requireResult(
            await ctx.projectModel.updateAgent(id, agentId, patch),
            'Binding not found',
          ),
          message: 'Project agent updated',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'updateAgent');
      }
    }),

  updateKnowledgeBase: projectWriteProcedure
    .input(idInput.extend({ knowledgeBaseId: z.string() }).merge(knowledgeBaseBindingPatch))
    .mutation(async ({ ctx, input: { id, knowledgeBaseId, ...patch } }) => {
      try {
        return {
          data: requireResult(
            await ctx.projectModel.updateKnowledgeBase(id, knowledgeBaseId, patch),
            'Binding not found',
          ),
          message: 'Project knowledge base updated',
          success: true,
        };
      } catch (error) {
        mapProjectError(error, 'updateKnowledgeBase');
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
