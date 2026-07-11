import {
  chatTopicStatusSchema,
  type HeteroSessionImportPayload,
  heteroSessionImportPayloadSchema,
  type RecentTopic,
  type RecentTopicGroup,
  type RecentTopicGroupMember,
  serializedAgentHookSchema,
} from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { inArray } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { TopicShareModel } from '@/database/models/topicShare';
import { AgentMigrationRepo } from '@/database/repositories/agentMigration';
import { HeteroSessionImporterRepo } from '@/database/repositories/heteroSessionImporter';
import { TopicImporterRepo } from '@/database/repositories/topicImporter';
import { chatGroups } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type BatchTaskResult } from '@/types/service';

import {
  batchResolveAgentIdFromSessions,
  resolveAgentIdFromSession,
  resolveContext,
} from './_helpers/resolveContext';
import { basicContextSchema } from './_schema/context';
import { workingDirConfigSchema } from './workingDirSchema';

const topicProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentMigrationRepo: new AgentMigrationRepo(ctx.serverDB, ctx.userId, wsId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      agentOperationModel: new AgentOperationModel(ctx.serverDB, ctx.userId, wsId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId, wsId),
      heteroSessionImporterRepo: new HeteroSessionImporterRepo(ctx.serverDB, ctx.userId, wsId),
      topicImporterRepo: new TopicImporterRepo(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
      topicShareModel: new TopicShareModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const topicRouter = router({
  getTopicDetail: topicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const topic = await ctx.topicModel.findById(input.id);
      if (!topic) return null;
      return topic;
    }),

  getTopicContext: topicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      const topic = await ctx.topicModel.findById(input.topicId);

      if (!topic) {
        return { content: `Topic not found: ${input.topicId}`, success: false };
      }

      const title = topic.title || 'Untitled';

      // Prefer historySummary if available
      if (topic.historySummary) {
        return {
          content: `# Topic: ${title}\n\n## Summary\n${topic.historySummary}`,
          success: true,
        };
      }

      // Fallback: fetch recent messages with correct agentId/groupId
      const wsId = ctx.workspaceId ?? undefined;
      const messageModel = new MessageModel(ctx.serverDB, ctx.userId, wsId);
      const messages = await messageModel.query({
        agentId: topic.agentId ?? undefined,
        groupId: topic.groupId ?? undefined,
        topicId: input.topicId,
      });

      const recentMessages = messages.slice(-30);
      const lines = [`# Topic: ${title}`, '', '## Recent Messages', ''];

      for (const msg of recentMessages) {
        const role =
          msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
        const content = (msg.content || '').trim();
        if (content) {
          lines.push(`**${role}**: ${content}`, '');
        }
      }

      return { content: lines.join('\n'), success: true };
    }),

  batchCreateTopics: topicProcedure
    .use(withScopedPermission('topic:create'))
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
      // Resolve sessionId for each topic
      const resolvedTopics = await Promise.all(
        input.map(async (item) => {
          const { agentId, ...rest } = item;
          const resolved = await resolveContext(
            { agentId, sessionId: rest.sessionId },
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );
          return { ...rest, sessionId: resolved.sessionId };
        }),
      );

      const data = await ctx.topicModel.batchCreate(resolvedTopics as any);

      return { added: data.length, ids: [], skips: [], success: true };
    }),

  batchDelete: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDelete(input.ids);
    }),

  batchDeleteByAgentId: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDeleteByAgentId(input.agentId);
    }),

  batchDeleteBySessionId: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(
      z.object({
        agentId: z.string().optional(),
        id: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const resolved = await resolveContext(
        { agentId: input.agentId, sessionId: input.id },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      return ctx.topicModel.batchDeleteBySessionId(resolved.sessionId);
    }),

  batchMoveTopics: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        targetAgentId: z.string(),
        topicIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchMoveToAgent(input.topicIds, input.targetAgentId);
    }),

  cloneTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
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

  createTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z
        .object({
          favorite: z.boolean().optional(),
          groupId: z.string().nullish(),
          messages: z.array(z.string()).optional(),
          title: z.string(),
          trigger: z.string().optional(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...rest } = input;
      const resolved = await resolveContext(
        { agentId, sessionId: rest.sessionId },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      const data = await ctx.topicModel.create({ ...rest, sessionId: resolved.sessionId });

      return data.id;
    }),

  /**
   * Disable sharing for a topic (deletes share record)
   */
  disableSharing: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicShareModel.deleteByTopicId(input.topicId);
    }),

  /**
   * Enable sharing for a topic (creates share record)
   */
  enableSharing: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        topicId: z.string(),
        visibility: z.enum(['private', 'link']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicShareModel.create(input.topicId, input.visibility);
    }),

  queryTopics: topicProcedure
    .input(
      z
        .object({
          pageSize: z.number().max(500).optional(),
          statuses: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.topicModel.queryTopics({ pageSize: input?.pageSize, statuses: input?.statuses });
    }),

  getShareInfo: topicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.topicShareModel.getByTopicId(input.topicId);
    }),

  getTopics: topicProcedure
    .input(
      z.object({
        agentId: z.string().nullish(),
        current: z.number().optional(),
        excludeStatuses: z.array(z.string()).optional(),
        excludeTriggers: z.array(z.string()).optional(),
        groupId: z.string().nullish(),
        includeTriggers: z.array(z.string()).optional(),
        isInbox: z.boolean().optional(),
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
        isInbox,
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

      // If sessionId is provided but no agentId, need to reverse lookup agentId
      let effectiveAgentId = rest.agentId;
      if (!effectiveAgentId && sessionId) {
        effectiveAgentId = await resolveAgentIdFromSession(
          sessionId,
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
      }

      const result = await ctx.topicModel.query({
        ...rest,
        agentId: effectiveAgentId,
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

      // Use Next.js after() for non-blocking execution
      after(runMigration);

      return { items: result.items, total: result.total };
    }),

  hasTopics: topicProcedure.query(async ({ ctx }) => {
    return (await ctx.topicModel.count()) === 0;
  }),

  getHeteroSessionImportStatus: topicProcedure
    .input(
      z.object({
        sessions: z.array(z.object({ sessionId: z.string(), topicClientId: z.string() })),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.heteroSessionImporterRepo.getImportStatus(input.sessions);
    }),

  importHeteroSessions: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string().nullish(),
        sessions: z.array(heteroSessionImportPayloadSchema),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.heteroSessionImporterRepo.importSessions({
        agentId: input.agentId,
        groupId: input.groupId,
        sessions: input.sessions as HeteroSessionImportPayload[],
      });
    }),

  importTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        agentId: z.string(),
        data: z.string(),
        groupId: z.string().nullish(),
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
          .where(inArray(chatGroups.id, allGroupIds));

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

  removeAllTopics: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .mutation(async ({ ctx }) => {
      return ctx.topicModel.deleteAll();
    }),

  removeTopic: topicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.delete(input.id);
    }),

  searchTopics: topicProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        groupId: z.string().nullish(),
        keywords: z.string(),
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

      // Scope the search exactly like the topics list (`query`): by agentId
      // directly (the new agent system stamps every topic with an agentId).
      // Passing only the resolved sessionId used to miss every agentId-scoped
      // topic — the cause of "no topics match" in the per-agent Topics search.
      // `containerId` is only the fallback for legacy callers that pass no
      // agentId/groupId.
      return ctx.topicModel.queryByKeyword(input.keywords, {
        agentId: input.agentId,
        containerId: resolved.sessionId,
        groupId: input.groupId,
      });
    }),

  /**
   * Update share visibility
   */
  updateShareVisibility: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        topicId: z.string(),
        visibility: z.enum(['private', 'link']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicShareModel.updateVisibility(input.topicId, input.visibility);
    }),

  updateTopic: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          agentId: z.string().optional(),
          completedAt: z.date().nullish(),
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
          status: chatTopicStatusSchema.nullish(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, ...restValue } = input.value;

      // If agentId is provided, resolve to sessionId
      let resolvedSessionId = restValue.sessionId;
      if (agentId && !resolvedSessionId) {
        const resolved = await resolveContext(
          { agentId },
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        resolvedSessionId = resolved.sessionId ?? undefined;
      }

      return ctx.topicModel.update(input.id, { ...restValue, sessionId: resolvedSessionId });
    }),

  updateTopicMetadata: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        metadata: z.object({
          boundDeviceId: z.string().optional(),
          heteroSessionId: z.string().optional(),
          heteroSessionIdByWorkingDirectory: z.record(z.string(), z.string()).optional(),
          model: z.string().optional(),
          onboardingFeedback: z
            .object({
              comment: z.string().max(500).optional(),
              rating: z.enum(['good', 'bad']),
              submittedAt: z.string(),
            })
            .optional(),
          onboardingSession: z
            .object({
              agentIdentityCompletedAt: z.string().optional(),
              agentMarketplacePick: z
                .object({
                  categoryHints: z.array(z.string()),
                  installedAgentIds: z.array(z.string()).optional(),
                  requestId: z.string(),
                  resolvedAt: z.string(),
                  selectedTemplateIds: z.array(z.string()).optional(),
                  skipReason: z.string().optional(),
                  skippedAgentIds: z.array(z.string()).optional(),
                  status: z.enum(['cancelled', 'skipped', 'submitted']),
                })
                .optional(),
              discoveryCompletedAt: z.string().optional(),
              finalAgentNames: z.array(z.string()).optional(),
              finishedAt: z.string().optional(),
              lastActiveAt: z.string().optional(),
              phase: z.enum(['agent_identity', 'user_identity', 'discovery', 'summary']).optional(),
              startedAt: z.string().optional(),
              userIdentityCompletedAt: z.string().optional(),
              version: z.number().optional(),
            })
            .optional(),
          provider: z.string().optional(),
          runningOperation: z
            .object({
              assistantMessageId: z.string(),
              hooks: z.array(serializedAgentHookSchema).optional(),
              operationId: z.string(),
              scope: z.string().optional(),
              threadId: z.string().nullish(),
            })
            .nullable()
            .optional(),
          repos: z.array(z.string()).optional(),
          workingDirectory: z.string().optional(),
          workingDirectoryConfig: workingDirConfigSchema.optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.updateMetadata(input.id, input.metadata);
    }),
});

export type TopicRouter = typeof topicRouter;
