import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { SessionModel } from '@/database/models/session';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import { insertAgentSchema, insertSessionSchema } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanEditResource } from '@/server/services/resourcePermission';
import { AgentChatConfigSchema } from '@/types/agent';
import { LobeMetaDataSchema } from '@/types/meta';
import { type BatchTaskResult } from '@/types/service';
import { type ChatSessionList, type LobeGroupSession } from '@/types/session';
import { TransferErrorCode } from '@/types/transferError';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
} from './_helpers/assertWorkspaceRowManageable';

/**
 * Session config updates write through to the linked agent's config, so a
 * workspace member with view/use access must not use them as an edit
 * escalation. Resolves the session's linked agent and runs the edit guard.
 * No-op in personal mode (no workspaceId).
 */
const assertCanEditSessionAgent = async (
  ctx: {
    serverDB: LobeChatDatabase;
    sessionModel: SessionModel;
    userId: string;
    workspaceId?: string | null;
  },
  sessionId: string,
) => {
  if (!ctx.workspaceId) return;

  const session = await ctx.sessionModel.findByIdOrSlug(sessionId);
  if (!session?.agent?.id) return;

  await assertCanEditResource({
    db: ctx.serverDB,
    resourceId: session.agent.id,
    resourceType: 'agent',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

const sessionProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      sessionGroupModel: new SessionGroupModel(ctx.serverDB, ctx.userId, wsId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

/**
 * @deprecated Session router is legacy. Use agent router for agent CRUD operations.
 * Session-based agent creation (createSession, batchCreateSessions) should migrate
 * to agent.createAgent which uses agentModel.create directly.
 * Session query/update methods are still used by mobile but should be migrated.
 */
export const sessionRouter = router({
  /** @deprecated Use agent.createAgent instead */
  batchCreateSessions: sessionProcedure
    .use(withScopedPermission('session:create'))
    .input(
      z.array(
        z
          .object({
            config: z.object({}).passthrough(),
            group: z.string().optional(),
            id: z.string(),
            meta: LobeMetaDataSchema,
            pinned: z.boolean().optional(),
            type: z.string(),
          })
          .partial(),
      ),
    )
    .mutation(async ({ input, ctx }): Promise<BatchTaskResult> => {
      const data = await ctx.sessionModel.batchCreate(
        input.map((item) => ({
          ...item,
          ...item.meta,
        })) as any,
      );

      return { added: data.rowCount as number, ids: [], skips: [], success: true };
    }),

  cloneSession: sessionProcedure
    .use(withScopedPermission('session:create'))
    .input(z.object({ id: z.string(), newTitle: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.sessionModel.duplicate(input.id, input.newTitle);

      return data?.id;
    }),

  countSessions: sessionProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.sessionModel.count(input);
    }),

  /** @deprecated Use agent.createAgent instead */
  createSession: sessionProcedure
    .use(withScopedPermission('session:create'))
    .input(
      z.object({
        config: insertAgentSchema
          .omit({
            chatConfig: true,
            openingMessage: true,
            openingQuestions: true,
            plugins: true,
            tags: true,
            tts: true,
          })
          .passthrough()
          .partial(),
        session: insertSessionSchema.omit({ createdAt: true, updatedAt: true }).partial(),
        type: z.enum(['agent', 'group']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.sessionModel.create(input);

      return data.id;
    }),

  getGroupedSessions: wsCompatProcedure
    .use(serverDatabase)
    .query(async ({ ctx }): Promise<ChatSessionList> => {
      const userId = ctx.userId;
      const serverDB = ctx.serverDB;
      const wsId = ctx.workspaceId ?? undefined;
      const sessionModel = new SessionModel(serverDB, userId, wsId);
      const chatGroupModel = new ChatGroupModel(serverDB, userId, wsId);

      const [{ sessions, sessionGroups }, chatGroups] = await Promise.all([
        sessionModel.queryWithGroups(),
        chatGroupModel.queryWithMemberDetails(),
      ]);

      const groupSessions: LobeGroupSession[] = chatGroups.map((group) => {
        const { title, description, avatar, backgroundColor, groupId, ...rest } = group;
        return {
          ...rest,
          group: groupId, // Map groupId to group for consistent API
          meta: { avatar, backgroundColor, description, title },
          type: 'group',
        };
      });

      const allSessions = [...sessions, ...groupSessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      return { sessionGroups, sessions: allSessions };
    }),

  getSessions: sessionProcedure
    .input(
      z.object({
        current: z.number().optional(),
        pageSize: z.number().max(100).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { current, pageSize } = input;

      return ctx.sessionModel.query({ current, pageSize });
    }),

  removeSession: sessionProcedure
    .use(withScopedPermission('session:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.sessionModel.findByIdOrSlug(input.id);
      if (session) assertWorkspaceRowManageable(ctx, session.userId, 'session');

      // Deleting the last session of a workspace-shared agent orphan-deletes
      // the agent itself, and the session cascade erases every member's
      // topics/messages on it — the same blast radius as `agent.removeAgent`,
      // so apply the same foreign-rows owner gate here.
      if (
        ctx.workspaceId &&
        session?.agent &&
        session.agent.visibility === 'public' &&
        isWorkspaceNonOwner(ctx)
      ) {
        const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
        if (await agentModel.transferHasForeignRows(session.agent.id)) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message:
              "Only workspace owners can delete a session whose shared agent carries others' conversations",
          });
        }
      }

      const { orphanedAgentIds, result } = await ctx.sessionModel.delete(input.id);

      // Mirror `agent.removeAgent`: orphan-deleted shared agents must not
      // leave dangling resource_permissions rows behind.
      if (ctx.workspaceId && orphanedAgentIds.length > 0) {
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all(orphanedAgentIds.map((id) => permissionModel.removeAll('agent', id)));
      }

      return result;
    }),

  searchSessions: sessionProcedure
    .input(z.object({ keywords: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.sessionModel.queryByKeyword(input.keywords);
    }),

  updateSession: sessionProcedure
    .use(withScopedPermission('session:update'))
    .input(
      z.object({
        id: z.string(),
        value: insertSessionSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.sessionModel.findByIdOrSlug(input.id);
      if (session) assertWorkspaceRowManageable(ctx, session.userId, 'session');

      return ctx.sessionModel.update(input.id, input.value);
    }),
  updateSessionChatConfig: sessionProcedure
    .use(withScopedPermission('session:update'))
    .input(
      z.object({
        id: z.string(),
        value: AgentChatConfigSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanEditSessionAgent(ctx, input.id);

      return ctx.sessionModel.updateConfig(input.id, {
        chatConfig: input.value,
      });
    }),
  updateSessionConfig: sessionProcedure
    .use(withScopedPermission('session:update'))
    .input(
      z.object({
        id: z.string(),
        value: z.object({}).passthrough().partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanEditSessionAgent(ctx, input.id);

      return ctx.sessionModel.updateConfig(input.id, input.value);
    }),
});

export type SessionRouter = typeof sessionRouter;
