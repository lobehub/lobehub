import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import type { TaskStatus } from '@lobechat/types';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { RecentModel } from '@/database/models/recent';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type { ChatTopicMetadata } from '@/types/topic';

export interface RecentItem {
  agentId?: string | null;
  description?: string | null;
  icon: string;
  id: string;
  lastAssistantMessage?: string | null;
  metadata?: ChatTopicMetadata;
  routePath: string;
  /** Task lifecycle status when `type === 'task'`; null for topic/document. */
  status: TaskStatus | null;
  title: string;
  type: 'topic' | 'document' | 'task';
  updatedAt: Date;
  /** The member who owns this item — for author attribution in workspace team views. */
  userId?: string;
}

const recentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      recentModel: new RecentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});

export const recentRouter = router({
  getAll: recentProcedure
    .input(
      z
        .object({
          limit: z.number().optional(),
          /** Restrict a workspace feed to the viewer's own items (mine/team toggle). */
          mineOnly: z.boolean().optional(),
          types: z.array(z.enum(['topic', 'document', 'task'])).optional(),
          withTopicPreview: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<RecentItem[]> => {
      const limit = input?.limit ?? 10;

      const items = await ctx.recentModel.queryRecent(
        limit,
        input?.types,
        input?.withTopicPreview,
        input?.mineOnly,
      );

      return items.map((item) => {
        let routePath: string;

        switch (item.type) {
          case 'topic': {
            if (item.routeGroupId) {
              routePath = GROUP_CHAT_TOPIC_URL(item.routeGroupId, item.id);
            } else if (item.routeId) {
              routePath = AGENT_CHAT_TOPIC_URL(item.routeId, item.id);
            } else {
              routePath = '/';
            }
            break;
          }
          case 'document': {
            routePath = `/page/${item.id}`;
            break;
          }
          case 'task': {
            routePath = item.routeId
              ? `/agent/${item.routeId}/task/${item.id}`
              : `/task/${item.id}`;
            break;
          }
        }

        return {
          agentId: item.routeId,
          description: item.description,
          icon: item.type,
          id: item.id,
          lastAssistantMessage: item.lastAssistantMessage,
          metadata: item.metadata as ChatTopicMetadata | undefined,
          routePath,
          status: item.status,
          title: item.title,
          type: item.type,
          updatedAt: item.updatedAt,
          userId: item.userId,
        };
      });
    }),
});

export type RecentRouter = typeof recentRouter;
