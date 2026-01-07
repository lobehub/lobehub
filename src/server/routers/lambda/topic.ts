import {
  type RecentTopic,
  type RecentTopicGroup,
  type RecentTopicGroupMember,
} from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { TopicModel } from '@/database/models/topic';
import { AgentMigrationRepo } from '@/database/repositories/agentMigration';
import { TopicImporterRepo } from '@/database/repositories/topicImporter';
import { agents, chatGroups, chatGroupsAgents } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type BatchTaskResult } from '@/types/service';

import {
  batchResolveAgentIdFromSessions,
  resolveAgentIdFromSession,
  resolveContext,
} from './_helpers/resolveContext';
import { basicContextSchema } from './_schema/context';

const topicProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentMigrationRepo: new AgentMigrationRepo(ctx.serverDB, ctx.userId),
      topicImporterRepo: new TopicImporterRepo(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const topicRouter = router({
  batchCreateTopics: topicProcedure
    .input(
      z.array(
        z
          .object({
            favorite: z.boolean().optional(),
            id: z.string().optional(),
            messages: z.array(z.string()).optional(),
            title: z.string(),
          })
          .extend(basicContextSchema.shape),
      ),
    )
    .mutation(async ({ input, ctx }): Promise<BatchTaskResult> => {
      // 解析每个 topic 的 sessionId
      const resolvedTopics = await Promise.all(
        input.map(async (item) => {
          const { agentId, ...rest } = item;
          const resolved = await resolveContext(
            { agentId, sessionId: rest.sessionId },
            ctx.serverDB,
            ctx.userId,
          );
          return { ...rest, sessionId: resolved.sessionId };
        }),
      );

      const data = await ctx.topicModel.batchCreate(resolvedTopics as any);

      return { added: data.length, ids: [], skips: [], success: true };
    }),

  batchDelete: topicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDelete(input.ids);
    }),

  batchDeleteBySessionId: topicProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        id: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const resolved = await resolveContext(
        { agentId: input.agentId, sessionId: input.id },
        ctx.serverDB,
        ctx.userId,
      );

      return ctx.topicModel.batchDeleteBySessionId(resolved.sessionId);
    }),

  cloneTopic: topicProcedure
    .input(z.object({ id: z.string(), newTitle: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.topicModel.duplicate(input.id, input.newTitle);

      return data.topic.id;
    }),

  countTopics: topicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          containerId: z.string().nullable().optional(),
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.topicModel.count(input);
    }),

  createTopic: topicProcedure
    .input(
      z
        .object({
          favorite: z.boolean().optional(),
          groupId: z.string().nullable().optional(),
          messages: z.array(z.string()).optional(),
          title: z.string(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...rest } = input;
      const resolved = await resolveContext(
        { agentId, sessionId: rest.sessionId },
        ctx.serverDB,
        ctx.userId,
      );

      const data = await ctx.topicModel.create({ ...rest, sessionId: resolved.sessionId });

      return data.id;
    }),

  getAllTopics: topicProcedure.query(async ({ ctx }) => {
    return ctx.topicModel.queryAll();
  }),

  getTopics: topicProcedure
    .input(
      z.object({
        agentId: z.string().nullable().optional(),
        current: z.number().optional(),
        groupId: z.string().nullable().optional(),
        isInbox: z.boolean().optional(),
        pageSize: z.number().optional(),
        sessionId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { sessionId, isInbox, groupId, ...rest } = input;

      // If groupId is provided, query by groupId directly
      if (groupId) {
        const result = await ctx.topicModel.query({ groupId, ...rest });
        return { items: result.items, total: result.total };
      }

      // 如果提供了 sessionId 但没有 agentId，需要反向查找 agentId
      let effectiveAgentId = rest.agentId;
      if (!effectiveAgentId && sessionId) {
        effectiveAgentId = await resolveAgentIdFromSession(sessionId, ctx.serverDB, ctx.userId);
      }

      const result = await ctx.topicModel.query({ ...rest, agentId: effectiveAgentId, isInbox });

      // Runtime migration: backfill agentId for ALL legacy topics and messages under this agent
      const runMigration = async () => {
        if (!effectiveAgentId) return;

        // Get the associated sessionId for migration
        const resolved = await resolveContext(
          { agentId: effectiveAgentId },
          ctx.serverDB,
          ctx.userId,
        );

        const migrationParams = isInbox
          ? { agentId: effectiveAgentId, isInbox: true as const, sessionId: resolved.sessionId }
          : resolved.sessionId
            ? { agentId: effectiveAgentId, sessionId: resolved.sessionId }
            : null;

        if (migrationParams) {
          try {
            await ctx.agentMigrationRepo.migrateAgentId(migrationParams);
          } catch (error) {
            console.error('[AgentMigration] Failed to migrate agentId:', error);
          }
        }
      };

      // Use Next.js after() for non-blocking execution
      after(runMigration);

      return { items: result.items, total: result.total };
    }),

  hasTopics: topicProcedure.query(async ({ ctx }) => {
    return (await ctx.topicModel.count()) === 0;
  }),

  importTopic: topicProcedure
    .input(
      z.object({
        agentId: z.string(),
        data: z.string(),
        groupId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.topicImporterRepo.importTopic({
        agentId: input.agentId,
        data: input.data,
        groupId: input.groupId,
      });

      return result;
    }),

  rankTopics: topicProcedure.input(z.number().optional()).query(async ({ ctx, input }) => {
    return ctx.topicModel.rank(input);
  }),

  recentTopics: topicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }): Promise<RecentTopic[]> => {
      const recentTopics = await ctx.topicModel.queryRecent(input?.limit ?? 12);

      // Separate agent topics and group topics
      const agentTopics = recentTopics.filter((t) => t.type === 'agent');
      const groupTopics = recentTopics.filter((t) => t.type === 'group');

      // Find legacy topics: no agentId but has sessionId
      const legacyTopics = agentTopics.filter(
        (topic) => topic.agentId === null && topic.sessionId !== null,
      );

      // Batch resolve agentId for legacy topics
      const sessionIds = [...new Set(legacyTopics.map((t) => t.sessionId!))];
      const sessionAgentMap = await batchResolveAgentIdFromSessions(
        sessionIds,
        ctx.serverDB,
        ctx.userId,
      );

      // Build agentId map: merge existing agentId with resolved ones
      const topicAgentIdMap = new Map<string, string>();
      for (const topic of agentTopics) {
        if (topic.agentId) {
          topicAgentIdMap.set(topic.id, topic.agentId);
        } else if (topic.sessionId) {
          const resolvedAgentId = sessionAgentMap.get(topic.sessionId);
          if (resolvedAgentId) {
            topicAgentIdMap.set(topic.id, resolvedAgentId);
          }
        }
      }

      // Collect all agentIds to fetch agent info
      const allAgentIds = [...new Set(topicAgentIdMap.values())];

      // Batch query agent info
      const agentInfoMap = new Map<
        string,
        { avatar: string | null; backgroundColor: string | null; id: string; title: string | null }
      >();

      if (allAgentIds.length > 0) {
        const agentInfos = await ctx.serverDB
          .select({
            avatar: agents.avatar,
            backgroundColor: agents.backgroundColor,
            id: agents.id,
            title: agents.title,
          })
          .from(agents)
          .where(inArray(agents.id, allAgentIds));

        for (const agent of agentInfos) {
          agentInfoMap.set(agent.id, agent);
        }
      }

      // Batch query group info with member avatars
      const groupInfoMap = new Map<string, RecentTopicGroup>();
      const allGroupIds = [...new Set(groupTopics.map((t) => t.groupId!).filter(Boolean))];

      if (allGroupIds.length > 0) {
        // Query chat groups
        const chatGroupInfos = await ctx.serverDB
          .select({
            id: chatGroups.id,
            title: chatGroups.title,
          })
          .from(chatGroups)
          .where(inArray(chatGroups.id, allGroupIds));

        // Query group member agents (get avatar info)
        const groupMembersRaw = await ctx.serverDB
          .select({
            agentAvatar: agents.avatar,
            agentBackgroundColor: agents.backgroundColor,
            chatGroupId: chatGroupsAgents.chatGroupId,
            order: chatGroupsAgents.order,
          })
          .from(chatGroupsAgents)
          .leftJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
          .where(inArray(chatGroupsAgents.chatGroupId, allGroupIds));

        // Group members by chatGroupId
        const groupMembersMap = new Map<string, RecentTopicGroupMember[]>();
        for (const member of groupMembersRaw) {
          const members = groupMembersMap.get(member.chatGroupId) || [];
          members.push({
            avatar: member.agentAvatar,
            backgroundColor: member.agentBackgroundColor,
          });
          groupMembersMap.set(member.chatGroupId, members);
        }

        // Build group info map
        for (const group of chatGroupInfos) {
          groupInfoMap.set(group.id, {
            id: group.id,
            members: groupMembersMap.get(group.id) || [],
            title: group.title,
          });
        }
      }

      // Runtime migration: backfill agentId for legacy topics
      const runMigration = async () => {
        for (const [sessionId, agentId] of sessionAgentMap) {
          try {
            await ctx.agentMigrationRepo.migrateAgentId({ agentId, sessionId });
          } catch (error) {
            console.error('[AgentMigration] Failed to migrate agentId for recentTopics:', error);
          }
        }
      };

      // Use Next.js after() for non-blocking execution
      after(runMigration);

      // Assemble final result
      return recentTopics.map((topic) => {
        if (topic.type === 'group' && topic.groupId) {
          const groupInfo = groupInfoMap.get(topic.groupId);
          return {
            agent: null,
            group: groupInfo ?? null,
            id: topic.id,
            title: topic.title,
            type: 'group' as const,
            updatedAt: topic.updatedAt,
          };
        }

        // Agent topic
        const agentId = topicAgentIdMap.get(topic.id);
        const agentInfo = agentId ? agentInfoMap.get(agentId) : null;

        return {
          agent: agentInfo ?? null,
          group: null,
          id: topic.id,
          title: topic.title,
          type: 'agent' as const,
          updatedAt: topic.updatedAt,
        };
      });
    }),

  removeAllTopics: topicProcedure.mutation(async ({ ctx }) => {
    return ctx.topicModel.deleteAll();
  }),

  removeTopic: topicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.delete(input.id);
    }),

  searchTopics: topicProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        groupId: z.string().nullable().optional(),
        keywords: z.string(),
        sessionId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const resolved = await resolveContext(
        { agentId: input.agentId, sessionId: input.sessionId },
        ctx.serverDB,
        ctx.userId,
      );

      return ctx.topicModel.queryByKeyword(input.keywords, resolved.sessionId);
    }),

  updateTopic: topicProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          agentId: z.string().optional(),
          favorite: z.boolean().optional(),
          historySummary: z.string().optional(),
          messages: z.array(z.string()).optional(),
          metadata: z
            .object({
              model: z.string().optional(),
              provider: z.string().optional(),
            })
            .optional(),
          sessionId: z.string().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...restValue } = input.value;

      // 如果提供了 agentId，解析为 sessionId
      let resolvedSessionId = restValue.sessionId;
      if (agentId && !resolvedSessionId) {
        const resolved = await resolveContext({ agentId }, ctx.serverDB, ctx.userId);
        resolvedSessionId = resolved.sessionId ?? undefined;
      }

      return ctx.topicModel.update(input.id, { ...restValue, sessionId: resolvedSessionId });
    }),

  updateTopicMetadata: topicProcedure
    .input(
      z.object({
        id: z.string(),
        metadata: z.object({
          model: z.string().optional(),
          provider: z.string().optional(),
          workingDirectory: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.updateMetadata(input.id, input.metadata);
    }),
});

export type TopicRouter = typeof topicRouter;
