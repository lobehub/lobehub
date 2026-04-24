import { z } from 'zod';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { RecentModel } from '@/database/models/recent';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type { ChatTopicMetadata } from '@/types/topic';

export interface RecentItem {
  agentId?: string | null;
  icon: string;
  id: string;
  metadata?: ChatTopicMetadata;
  routePath: string;
  title: string;
  type: 'topic' | 'document' | 'task';
  updatedAt: Date;
}

const recentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      recentModel: new RecentModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const recentRouter = router({
  getAll: recentProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }): Promise<RecentItem[]> => {
      const limit = input?.limit ?? 10;

      const items = await ctx.recentModel.queryRecent(limit);

      return items.map((item) => {
        let routePath: string;

        switch (item.type) {
          case 'topic': {
            if (item.routeGroupId) {
              routePath = `/group/${item.routeGroupId}?topic=${item.id}`;
            } else if (item.routeId) {
              routePath = SESSION_CHAT_TOPIC_URL(item.routeId, item.id);
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
            routePath = item.routeId ? `/agent/${item.routeId}` : '/';
            break;
          }
        }

        return {
          agentId: item.routeId,
          icon: item.type,
          id: item.id,
          metadata: item.metadata as ChatTopicMetadata | undefined,
          routePath,
          title: item.title,
          type: item.type,
          updatedAt: item.updatedAt,
        };
      });
    }),
});

export type RecentRouter = typeof recentRouter;
