import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { SessionModel } from '@/database/models/session';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import { insertAgentSchema, insertSessionSchema } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentChatConfigSchema } from '@/types/agent';
import { LobeMetaDataSchema } from '@/types/meta';
import { type BatchTaskResult } from '@/types/service';
import { type ChatSessionList, type LobeGroupSession } from '@/types/session';

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
      return ctx.sessionModel.delete(input.id);
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
      return ctx.sessionModel.updateConfig(input.id, input.value);
    }),
});

export type SessionRouter = typeof sessionRouter;
