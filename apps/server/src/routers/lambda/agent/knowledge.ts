import type { KnowledgeItem } from '@lobechat/types';
import { KnowledgeType } from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { router } from '@/libs/trpc/lambda';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
} from '@/server/services/resourcePermission';

import {
  getRestrictedKnowledgeBaseIds,
  getUseLevelKnowledgeBaseIds,
} from '../_helpers/knowledgeBaseAccess';
import { agentProcedure } from './procedures';

export const knowledgeRouter = router({
  createAgentFiles: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.createAgentFiles(input.agentId, input.fileIds, input.enabled);
    }),
  createAgentKnowledgeBase: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.createAgentKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),
  deleteAgentFile: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.deleteAgentFile(input.agentId, input.fileId);
    }),
  deleteAgentKnowledgeBase: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.deleteAgentKnowledgeBase(input.agentId, input.knowledgeBaseId);
    }),
  getKnowledgeBasesAndFiles: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<KnowledgeItem[]> => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // Look up the target agent's visibility so we can (a) apply the
      // "public agent cannot reach caller's private rows" defensive filter
      // in the model layer, and (b) hard-force `visibility='public'` when
      // the agent is public — the client tab is a UX aid, not a gate.
      const agentVisibility = await ctx.agentModel.getAgentVisibility(input.agentId);

      // `visibility` is workspace-scoped. In personal mode buildWorkspaceWhere
      // ignores the column entirely (every row is implicitly private to its
      // owner) while the column still defaults to 'public', so forcing a scope
      // here would filter personal rows by a value that carries no meaning.
      // Only workspace agents get a visibility scope.
      const effectiveVisibility = ctx.workspaceId
        ? agentVisibility === 'public'
          ? ('public' as const)
          : input.visibility
        : undefined;

      const knowledgeBases = await ctx.knowledgeBaseModel.query({
        callerAgentVisibility: agentVisibility,
        visibility: effectiveVisibility,
      });

      const files = await ctx.fileModel.query({
        callerAgentVisibility: agentVisibility,
        showFilesInKnowledgeBase: false,
        visibility: effectiveVisibility,
      });

      const knowledge = await ctx.agentModel.getAgentAssignedKnowledge(input.agentId);

      // Member-restricted (No-access) KBs disappear from the picker for
      // non-privileged members, except ones already attached to this agent —
      // an invisible-but-attached row would be impossible to unmount. Managers
      // keep seeing them, with a flag so the client can badge the icon.
      const [restrictedForCaller, useLevelIds] = ctx.workspaceId
        ? await Promise.all([
            getRestrictedKnowledgeBaseIds(ctx),
            getUseLevelKnowledgeBaseIds(ctx.serverDB, ctx.workspaceId),
          ])
        : [[], []];
      const restrictedSet = new Set(restrictedForCaller);
      const memberRestrictedSet = new Set(useLevelIds);
      const visibleKnowledgeBases = knowledgeBases.filter(
        (kb) =>
          !restrictedSet.has(kb.id) || knowledge.knowledgeBases.some((item) => item.id === kb.id),
      );

      return [
        ...files
          // Filter out all images
          .filter((file) => !file.fileType.startsWith('image'))
          .map((file) => ({
            enabled: knowledge.files.some((item) => item.id === file.id),
            fileType: file.fileType,
            id: file.id,
            name: file.name,
            ownerUserId: file.userId,
            type: KnowledgeType.File,
            visibility: file.visibility as 'private' | 'public',
          })),
        ...visibleKnowledgeBases.map((knowledgeBase) => ({
          avatar: knowledgeBase.avatar,
          description: knowledgeBase.description,
          enabled: knowledge.knowledgeBases.some((item) => item.id === knowledgeBase.id),
          id: knowledgeBase.id,
          memberRestricted: memberRestrictedSet.has(knowledgeBase.id),
          name: knowledgeBase.name,
          ownerUserId: knowledgeBase.userId,
          type: KnowledgeType.KnowledgeBase,
          visibility: knowledgeBase.visibility,
        })),
      ];
    }),
  toggleFile: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.toggleFile(input.agentId, input.fileId, input.enabled);
    }),
  toggleKnowledgeBase: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.toggleKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),
});
