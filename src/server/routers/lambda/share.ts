import {
  type SharedDocumentData,
  type SharedDocumentPayload,
  type SharedTopicData,
} from '@lobechat/types';
import { z } from 'zod';

import { DocumentShareModel } from '@/database/models/documentShare';
import { TopicShareModel } from '@/database/models/topicShare';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const pickShareableDocument = (
  doc: Awaited<ReturnType<typeof DocumentShareModel.findByDocumentId>>['document'],
  isOwner: boolean,
): SharedDocumentPayload => {
  const safeMetadata =
    doc.metadata && isOwner
      ? doc.metadata
      : doc.metadata?.emoji
        ? { emoji: doc.metadata.emoji as string }
        : null;

  return {
    content: doc.content,
    description: doc.description,
    editorData: doc.editorData,
    fileType: doc.fileType,
    id: doc.id,
    metadata: safeMetadata,
    pages: (doc.pages as unknown[] | null) ?? null,
    title: doc.title,
    updatedAt: doc.updatedAt,
  };
};

export const shareRouter = router({
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

  /**
   * Get shared document for public access.
   * - Owner: always returns full payload, isOwner=true, regardless of visibility.
   * - Non-owner with visibility=link: returns sanitized read-only payload, isOwner=false.
   * - Non-owner with visibility=private (or no share row): throws FORBIDDEN.
   */
  getSharedDocument: publicProcedure
    .use(serverDatabase)
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }): Promise<SharedDocumentData> => {
      const result = await DocumentShareModel.findByDocumentIdWithAccessCheck(
        ctx.serverDB,
        input.documentId,
        ctx.userId ?? undefined,
      );

      if (!result.isOwner) {
        await DocumentShareModel.incrementPageViewCount(ctx.serverDB, input.documentId);
      }

      return {
        document: pickShareableDocument(result.document, result.isOwner),
        isOwner: result.isOwner,
        ownerMeta: {
          avatar: result.ownerAvatar,
          displayName: result.ownerDisplayName,
        },
        pageViewCount: result.pageViewCount,
        permission: result.permission,
        visibility: result.visibility,
      };
    }),
});

export type ShareRouter = typeof shareRouter;
