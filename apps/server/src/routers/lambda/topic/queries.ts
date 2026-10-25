import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  type RecentTopic,
  type RecentTopicGroup,
  type RecentTopicGroupMember,
} from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { MessageModel } from '@/database/models/message';
import { agents, chatGroups } from '@/database/schemas';
import { notTrashed } from '@/database/utils/softDelete';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { router } from '@/libs/trpc/lambda';
import { TopicReferenceService } from '@/server/services/topicReference';
import { after } from '@/server/utils/scheduleAfterResponse';

import { assertCanUseConversationTargets } from '../_helpers/conversationResourceGuard';
import { batchResolveAgentIdFromSessions, resolveContext } from '../_helpers/resolveContext';
import { guardCtx, topicProcedure, topicSearchProcedure } from './procedures';

export const queryRouter = router({
  getTopicDetail: topicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const topic = await ctx.topicModel.findOwnTopicById(input.id);
      if (!topic) return null;
      return topic;
    }),
  getTopicTranscript: topicProcedure
    .input(
      z.object({
        includeMessages: z.boolean().default(true),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        topicId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      // `lh topic view` from a workspace run may be given one of the user's personal topic ids.
      const topic = await new TopicReferenceService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).findTopic(input.topicId);

      if (!topic) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Topic not found: ${input.topicId}`,
        });
      }

      if (!input.includeMessages) {
        return { items: [], topic, total: null };
      }

      const messageModel =
        (topic.workspaceId ?? undefined) === (ctx.workspaceId ?? undefined)
          ? ctx.messageModel
          : new MessageModel(ctx.serverDB, ctx.userId, topic.workspaceId ?? undefined);
      const transcript = await messageModel.queryTopicTranscript({
        limit: input.limit,
        offset: input.offset,
        topicId: input.topicId,
      });

      return { ...transcript, topic };
    }),
  /**
   * @deprecated The `lobe-topic-reference` tool was removed; agents read topics with
   * `lh topic view`. Kept for released Desktop builds and cached web bundles whose
   * client executor still calls this. Remove once those clients have aged out.
   */
  getTopicContext: topicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) =>
      new TopicReferenceService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).getTopicContext(input),
    ),
  countTopics: topicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          containerId: z.string().nullish(),
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.topicModel.count(input);
    }),
  queryTopics: topicProcedure
    .input(
      z
        .object({
          pageSize: z.number().max(500).optional(),
          statuses: z.array(z.string()).optional(),
          withLastMessage: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.topicModel.queryTopics({
        pageSize: input?.pageSize,
        statuses: input?.statuses,
        withLastMessage: input?.withLastMessage,
      });
    }),
  getTopics: topicProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        current: z.number().optional(),
        /**
         * Scope an `agentId` query to the builder conversations that configured
         * one target. Builder panels show their full history on purpose; these
         * are for callers that want a single agent's / group's builds.
         */
        editingAgentId: z.string().nullish(),
        editingGroupId: z.string().nullish(),
        excludeStatuses: z.array(z.string()).optional(),
        excludeTriggers: z.array(z.string()).optional(),
        groupId: z.string().nullish(),
        includeTriggers: z.array(z.string()).optional(),
        isInbox: z.boolean().optional(),
        /** Only topics the caller created — the workspace "only mine" filter. */
        onlyMine: z.boolean().optional(),
        pageSize: z.number().max(100).optional(),
        sessionId: z.string().nullish(),
        /**
         * Server-side ordering. Defaults to `updatedAt`; `status` orders by
         * status priority for the sidebar "group by status" mode.
         */
        sortBy: z.enum(['updatedAt', 'status']).optional(),
        triggers: z.array(z.string()).optional(),
        /**
         * When true, returns extra card-detail columns (firstUserMessage,
         * messageCount, cost, tokenUsage, description, trigger). Default false
         * so the sidebar list stays cheap — only the management page opts in.
         */
        withDetails: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const {
        sessionId,
        isInbox: _isInbox,
        groupId,
        excludeStatuses,
        excludeTriggers,
        includeTriggers,
        triggers,
        ...rest
      } = input;

      // If groupId is provided, query by groupId directly
      if (groupId) {
        const result = await ctx.topicModel.query({
          excludeStatuses,
          excludeTriggers,
          groupId,
          includeTriggers,
          triggers,
          ...rest,
        });
        return { items: result.items, total: result.total };
      }

      const resolvedContext = await resolveContext(
        { agentId: rest.agentId ?? undefined, sessionId },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const effectiveAgentId = resolvedContext.agentId ?? undefined;
      await assertCanUseConversationTargets(guardCtx(ctx), [resolvedContext]);

      // Inbox semantics come from the authorized canonical Agent, never an
      // optional client flag (released native clients may omit or cache it).
      const inboxAgent = effectiveAgentId
        ? await ctx.serverDB.query.agents.findFirst({
            columns: { id: true },
            where: and(
              eq(agents.id, effectiveAgentId),
              eq(agents.slug, INBOX_SESSION_ID),
              buildWorkspaceWhere(
                { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
                agents,
              ),
            ),
          })
        : undefined;
      const isInbox = !!inboxAgent;

      const result = await ctx.topicModel.query({
        ...rest,
        agentId: effectiveAgentId,
        legacySessionId: resolvedContext.sessionId,
        excludeStatuses,
        excludeTriggers,
        includeTriggers,
        isInbox,
        triggers,
      });

      // Runtime migration: backfill agentId for ALL legacy topics and messages under this agent
      const runMigration = async () => {
        if (!effectiveAgentId) return;

        // Get the associated sessionId for migration
        const resolved = await resolveContext(
          { agentId: effectiveAgentId },
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
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

      after(runMigration);

      return { items: result.items, total: result.total };
    }),
  hasTopicFiles: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .query(async ({ input, ctx }) => {
      try {
        const hasFiles = await ctx.fileModel.hasFilesByTopicIds(input.ids);
        return { data: { hasFiles }, success: true };
      } catch (error) {
        console.error('[topic:hasTopicFiles]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check topic files',
        });
      }
    }),
  hasTopics: topicProcedure.query(async ({ ctx }) => {
    return (await ctx.topicModel.count()) === 0;
  }),
  getMaxTaskDuration: topicProcedure.query(async ({ ctx }) => {
    return ctx.agentOperationModel.getMaxDurationSeconds();
  }),
  rankTopics: topicProcedure.input(z.number().max(50).optional()).query(async ({ ctx, input }) => {
    return ctx.topicModel.rank(input);
  }),
  recentTopics: topicProcedure
    .input(z.object({ limit: z.number().max(50).optional() }).optional())
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
        ctx.workspaceId ?? undefined,
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

      // Batch query agent info (already normalized for the inbox agent)
      const agentInfoMap = new Map<
        string,
        { avatar: string | null; backgroundColor: string | null; id: string; title: string | null }
      >();

      if (allAgentIds.length > 0) {
        const agentInfos = await ctx.agentModel.getAgentAvatarsByIds(allAgentIds);

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
          .where(and(inArray(chatGroups.id, allGroupIds), notTrashed(chatGroups.isDeleted)));

        // Query group member avatars (already normalized for the inbox agent)
        const groupMembersMap: Map<string, RecentTopicGroupMember[]> =
          await ctx.chatGroupModel.getMemberAvatarsByGroupIds(allGroupIds);

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

        // Always return agent with id if agentId exists (even if avatar/title are null)
        // Frontend needs agent.id to generate links
        const validAgent = agentInfo ? cleanObject(agentInfo) : null;

        return {
          agent: validAgent,
          group: null,
          id: topic.id,
          title: topic.title,
          type: 'agent' as const,
          updatedAt: topic.updatedAt,
        };
      });
    }),
  searchTopics: topicSearchProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        groupId: z.string().nullish(),
        keywords: z.string(),
        /** Only topics the caller created — the workspace "only mine" filter. */
        onlyMine: z.boolean().optional(),
        sessionId: z.string().nullish(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const resolved = await resolveContext(
        { agentId: input.agentId, sessionId: input.sessionId },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      await assertCanUseConversationTargets(guardCtx(ctx), [resolved]);

      const searchOptions = { onlyMine: input.onlyMine };
      const scope = {
        agentId: resolved.agentId ?? undefined,
        containerId: resolved.sessionId,
        groupId: input.groupId,
      };
      const byAgent = ctx.topicModel.queryByKeyword(input.keywords, scope, searchOptions);
      if (!resolved.agentId || !resolved.sessionId || input.groupId) return byAgent;

      // Legacy topics can still lack agentId before the existing on-read
      // migration finishes. Search both scopes through the same search backend;
      // only unassigned legacy rows may supplement the canonical Agent result.
      const [current, legacy] = await Promise.all([
        byAgent,
        ctx.topicModel.queryByKeyword(
          input.keywords,
          { containerId: resolved.sessionId },
          searchOptions,
        ),
      ]);
      return [
        ...new Map(
          [...current, ...legacy.filter((topic) => !topic.agentId)].map((topic) => [
            topic.id,
            topic,
          ]),
        ).values(),
      ];
    }),
});
