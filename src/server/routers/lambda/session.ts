import { z } from 'zod';

import { ChatGroupModel } from '@/database/models/chatGroup';
import { SessionModel } from '@/database/models/session';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import { insertAgentSchema, insertSessionSchema } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentChatConfigSchema } from '@/types/agent';
import { LobeMetaDataSchema } from '@/types/meta';
import type {BatchTaskResult} from '@/types/service';
import type {ChatSessionList, LobeGroupSession} from '@/types/session';

const sessionProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      sessionGroupModel: new SessionGroupModel(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const sessionRouter = router({
  batchCreateSessions: sessionProcedure
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

  createSession: sessionProcedure
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

  getGroupedSessions: publicProcedure.query(async ({ ctx }): Promise<ChatSessionList> => {
    const userId = ctx.userId;
    if (!userId) return { sessionGroups: [], sessions: [] };

    const serverDB = await getServerDB();
    const sessionModel = new SessionModel(serverDB, userId);
    const chatGroupModel = new ChatGroupModel(serverDB, userId);

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
        pageSize: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { current, pageSize } = input;

      return ctx.sessionModel.query({ current, pageSize });
    }),

  rankSessions: sessionProcedure.input(z.number().optional()).query(async ({ ctx, input }) => {
    return ctx.sessionModel.rank(input);
  }),

  removeAllSessions: sessionProcedure.mutation(async ({ ctx }) => {
    return ctx.sessionModel.deleteAll();
  }),

  removeSession: sessionProcedure
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
