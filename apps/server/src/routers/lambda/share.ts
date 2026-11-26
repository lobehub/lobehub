import { type SharedAgentData, type SharedTopicData, type UIChatMessage } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel } from '@/database/models/message';
import { TopicShareModel } from '@/database/models/topicShare';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { buildSharedAgentData } from '@/server/services/agentShare/sharedAgentData';

import { assertAgentShareVisitorEnabled } from './_helpers/agentShareFeatureGate';
import { sharedTopicText } from './_helpers/sharedTopicText';

const log = debug('lobe-server:router:share');

export const shareRouter = router({
  getSharedTopicText: publicProcedure
    .use(serverDatabase)
    .input(z.object({ shareId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }) => {
      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId ?? undefined,
      );
      const model = new MessageModel(ctx.serverDB, share.ownerId, share.workspaceId ?? undefined);
      const messages: UIChatMessage[] = [];
      let offset = 0;
      while (true) {
        const { items, total } = await model.queryTopicTranscript({
          limit: 1000,
          offset,
          topicId: share.topicId,
        });
        messages.push(
          ...items
            .filter((item) => !item.threadId)
            .map(
              (item) =>
                ({
                  ...item,
                  agentId: item.agentId ?? undefined,
                  content: item.content ?? '',
                  createdAt: item.createdAt.getTime(),
                  updatedAt: item.createdAt.getTime(),
                  parentId: item.parentId ?? undefined,
                  tools: item.tools ?? undefined,
                }) as UIChatMessage,
            ),
        );
        offset += items.length;
        if (offset >= total || items.length === 0) break;
      }

      return { text: sharedTopicText(messages), title: share.title };
    }),
  /**
   * Resolve the visitor-facing metadata for an agent share, by its custom
   * slug or its raw share id.
   *
   * Public so a signed-out visitor can read the share's landing page before
   * deciding to sign in; starting a conversation still requires a session
   * (`channel.openShared` is authed). Everything returned is computed as the
   * share OWNER, never as the caller, so an anonymous caller sees exactly what
   * a signed-in stranger sees.
   *
   * `findBySlugOrId` intentionally does NOT enforce visibility — it resolves
   * whatever share matches, of ANY visibility; the (private → owner only,
   * link → any authed viewer) gate runs on the resolved row via the shared
   * `assertShareAccess` helper, so no second lookup is needed.
   *
   * Deployment support applies to every viewer, including owner previews.
   * The rollout flag only gates publishing, never access to an existing share.
   */
  getSharedAgent: publicProcedure
    .use(serverDatabase)
    .input(z.object({ slugOrId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }): Promise<SharedAgentData> => {
      assertAgentShareVisitorEnabled();

      const share = await AgentShareModel.findBySlugOrId(ctx.serverDB, input.slugOrId);

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }

      // A public procedure skips `oidcAuth`, which confines a sandbox
      // `hetero-operation` token to its own routes. Read such a caller as
      // signed out so the token cannot unlock the owner's private shares.
      const viewerId = ctx.oidcAuth?.purpose === 'hetero-operation' ? null : ctx.userId;

      AgentShareModel.assertShareAccess(share, viewerId);

      const isOwner = !!viewerId && share.ownerId === viewerId;

      if (!isOwner && viewerId) {
        // Owner previews are not counted: userViewCount tracks signed-in
        // visitor page views (PV, not deduplicated visitors). Anonymous loads
        // are not counted either, so an unauthenticated client cannot inflate
        // the counter. The counter is analytics
        // only, so it is best-effort: a failed increment must never turn an
        // otherwise valid share page into an error for the visitor.
        try {
          await AgentShareModel.incrementUserViewCount(ctx.serverDB, share.shareId);
        } catch (error) {
          log('failed to increment view count for share %s: %O', share.shareId, error);
        }
      }

      return buildSharedAgentData(ctx.serverDB, share, { isOwner });
    }),

  /**
   * Get shared topic metadata for public access
   * Uses shareId (not topicId) for access
   * Visibility check: owner can always access, others depend on visibility setting
   */
  getSharedTopic: publicProcedure
    .use(serverDatabase)
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }): Promise<SharedTopicData> => {
      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId ?? undefined,
      );

      // Increment page view count after visibility check passes
      await TopicShareModel.incrementPageViewCount(ctx.serverDB, input.shareId);

      return {
        agentId: share.agentId,
        agentMeta: share.agentId
          ? {
              avatar: share.agentAvatar,
              backgroundColor: share.agentBackgroundColor,
              marketIdentifier: share.agentMarketIdentifier,
              name: share.agentName,
              slug: share.agentSlug,
              title: share.agentTitle,
            }
          : undefined,
        groupId: share.groupId,
        groupMeta: share.groupId
          ? {
              avatar: share.groupAvatar,
              backgroundColor: share.groupBackgroundColor,
              createdAt: share.groupCreatedAt,
              members: share.groupMembers,
              title: share.groupTitle,
              updatedAt: share.groupUpdatedAt,
              userId: share.groupUserId,
            }
          : undefined,
        shareId: share.shareId,
        title: share.title,
        topicId: share.topicId,
        visibility: share.visibility as SharedTopicData['visibility'],
      };
    }),
});

export type ShareRouter = typeof shareRouter;
