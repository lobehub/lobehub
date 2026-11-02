import {
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
  MARKDOWN_MIME_TYPES,
  RESOURCE_CONTENT_PREVIEW_SOURCE_LENGTH,
} from '@lobechat/const';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { serverDBEnv } from '@/config/db';
import { router } from '@/libs/trpc/lambda';
import { createResourceContentPreview } from '@/server/utils/resourceContentPreview';
import type { FileListItem, KnowledgeItemStatus } from '@/types/files';
import { QueryFileListSchema } from '@/types/files';

import {
  assertContentsNotInRestrictedKnowledgeBase,
  assertKnowledgeBaseBrowsable,
  getRestrictedKnowledgeBaseIds,
} from '../_helpers/knowledgeBaseAccess';
import { fileProcedure, getKnowledgeItemStatusMap } from './procedures';

const deleteKnowledgeItemsByQuerySchema = QueryFileListSchema.extend({
  excludedIds: z.array(z.string()).optional(),
});

const markdownPreviewTypes = new Set<string>(MARKDOWN_MIME_TYPES);

const KNOWLEDGE_ITEM_RESOLUTION_CONCURRENCY = 8;

const isMarkdownFile = (item: { fileType: string; name: string }) =>
  markdownPreviewTypes.has(item.fileType) || /\.md(?:arkdown)?$/i.test(item.name);

const filterKnowledgeItems = <
  T extends {
    fileType: string;
    sourceType: string;
  },
>(
  items: T[],
  knowledgeBaseId?: string,
) => {
  return !knowledgeBaseId
    ? items.filter(
        (item) =>
          !(
            item.sourceType === DERIVED_DOCUMENT_SOURCE_TYPE &&
            item.fileType === CUSTOM_FOLDER_FILE_TYPE
          ),
      )
    : items;
};

export const knowledgeItemsRouter = router({
  getKnowledgeItemStatusesByIds: fileProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }): Promise<KnowledgeItemStatus[]> => {
      const ids = [...new Set(input.ids)];
      if (ids.length === 0) return [];

      const fileItems = await ctx.fileModel.findByIds(ids);
      const statusMap = await getKnowledgeItemStatusMap(ctx, fileItems);

      return ids.flatMap((id) => {
        const status = statusMap.get(id);
        return status ? [status] : [];
      });
    }),
  getKnowledgeItems: fileProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    if (input.knowledgeBaseId) await assertKnowledgeBaseBrowsable(ctx, input.knowledgeBaseId);
    const excludeKnowledgeBaseIds = input.knowledgeBaseId
      ? undefined
      : await getRestrictedKnowledgeBaseIds(ctx);

    // Request one more item than limit to check if there are more items
    const limit = input.limit ?? 50;
    // Absent preserves the legacy response for released clients. Current list
    // surfaces explicitly send false (metadata only) or true (bounded preview).
    const includeContent = input.includeContentPreview === undefined;
    const includeContentPreview = input.includeContentPreview === true;
    const knowledgeItems = await ctx.knowledgeRepo.query({
      ...input,
      excludeKnowledgeBaseIds,
      includeContent,
      includeContentPreview,
      limit: limit + 1,
    });

    // Check if there are more items
    const hasMore = knowledgeItems.length > limit;

    // Take only the requested number of items
    const itemsToProcess = hasMore ? knowledgeItems.slice(0, limit) : knowledgeItems;

    // Filter out folders from Documents category when in Inbox (no knowledgeBaseId)
    const filteredItems = filterKnowledgeItems(itemsToProcess, input.knowledgeBaseId);

    // Process files (add chunk info and async task status)
    const fileItems = filteredItems.filter((item) => item.sourceType === 'file');
    const statusMap = await getKnowledgeItemStatusMap(ctx, fileItems);

    // Resolve file access URLs and raw Markdown previews with bounded concurrency:
    // each item may perform Redis/S3 I/O, so serial work is slow while an unbounded
    // Promise.all lets a caller fan out arbitrary object-storage reads.
    const resultItems = await pMap(
      filteredItems,
      async (item) => {
        let contentPreviewSource = item.contentPreviewSource;
        if (
          includeContentPreview &&
          item.sourceType === 'file' &&
          !item.documentId &&
          !contentPreviewSource &&
          item.url &&
          isMarkdownFile(item)
        ) {
          try {
            contentPreviewSource = await ctx.fileService.getFileContent(
              item.url,
              RESOURCE_CONTENT_PREVIEW_SOURCE_LENGTH,
            );
          } catch {
            // Preview failure must not fail the resource list. The derived
            // document will become the normal source once parsing completes.
          }
        }
        const contentPreview = includeContentPreview
          ? createResourceContentPreview({
              content: contentPreviewSource,
              fileType: item.fileType,
              title: item.name,
            })
          : undefined;

        if (item.sourceType === 'file') {
          const status = statusMap.get(item.id)!;
          return {
            chunkCount: status.chunkCount,
            chunkingError: status.chunkingError,
            chunkingStatus: status.chunkingStatus,
            ...(includeContent ? { content: item.content } : {}),
            ...(includeContent ? { editorData: null } : {}),
            ...(includeContentPreview ? { contentPreview } : {}),
            createdAt: item.createdAt,
            embeddingError: status.embeddingError,
            embeddingStatus: status.embeddingStatus,
            fileId: item.fileId,
            fileType: item.fileType,
            finishEmbedding: status.finishEmbedding,
            hasChildren: item.hasChildren,
            id: item.id,
            knowledgeBaseIds: item.knowledgeBaseIds,
            metadata: item.metadata,
            name: item.name,
            size: item.size,
            slug: item.slug,
            sourceType: item.sourceType,
            updatedAt: item.updatedAt,
            uploader: item.uploader,
            url: await ctx.fileService.getFileAccessUrl(item),
            userId: item.userId,
            visibility: item.visibility,
          } as FileListItem;
        }
        return {
          chunkCount: null,
          chunkingError: null,
          chunkingStatus: null,
          ...(includeContent ? { content: item.content } : {}),
          ...(includeContent ? { editorData: item.editorData } : {}),
          ...(includeContentPreview ? { contentPreview } : {}),
          createdAt: item.createdAt,
          embeddingError: null,
          embeddingStatus: null,
          fileId: item.fileId,
          fileType: item.fileType,
          finishEmbedding: false,
          hasChildren: item.hasChildren,
          id: item.id,
          metadata: item.metadata,
          name: item.name,
          size: item.size,
          slug: item.slug,
          sourceType: item.sourceType,
          updatedAt: item.updatedAt,
          uploader: item.uploader,
          url: item.url ?? '',
          userId: item.userId,
          visibility: item.visibility,
        } as FileListItem;
      },
      { concurrency: KNOWLEDGE_ITEM_RESOLUTION_CONCURRENCY },
    );

    return {
      hasMore,
      items: resultItems,
    };
  }),
  resolveKnowledgeItemIds: fileProcedure
    .input(QueryFileListSchema)
    .query(async ({ ctx, input }): Promise<{ ids: string[]; total: number }> => {
      if (input.knowledgeBaseId) await assertKnowledgeBaseBrowsable(ctx, input.knowledgeBaseId);
      const excludeKnowledgeBaseIds = input.knowledgeBaseId
        ? undefined
        : await getRestrictedKnowledgeBaseIds(ctx);

      const ids: string[] = [];
      const batchSize = 500;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const knowledgeItems = await ctx.knowledgeRepo.query({
          ...input,
          excludeKnowledgeBaseIds,
          includeContent: false,
          includeContentPreview: false,
          limit: batchSize + 1,
          offset,
        });

        const currentHasMore = knowledgeItems.length > batchSize;
        const itemsToProcess = currentHasMore ? knowledgeItems.slice(0, batchSize) : knowledgeItems;
        const filteredItems = filterKnowledgeItems(itemsToProcess, input.knowledgeBaseId);

        ids.push(...filteredItems.map((item) => item.id));

        offset += itemsToProcess.length;
        hasMore = currentHasMore;
      }

      return { ids, total: ids.length };
    }),
  deleteKnowledgeItemsByQuery: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(deleteKnowledgeItemsByQuerySchema)
    .mutation(async ({ ctx, input }): Promise<{ count: number }> => {
      if (input.knowledgeBaseId) await assertKnowledgeBaseBrowsable(ctx, input.knowledgeBaseId);
      const excludeKnowledgeBaseIds = input.knowledgeBaseId
        ? undefined
        : await getRestrictedKnowledgeBaseIds(ctx);
      const { excludedIds = [], ...query } = input;
      const excludedIdSet = new Set(excludedIds);

      const fileIds: string[] = [];
      const documentIds: string[] = [];
      const batchSize = 500;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const knowledgeItems = await ctx.knowledgeRepo.query({
          ...query,
          excludeKnowledgeBaseIds,
          includeContent: false,
          includeContentPreview: false,
          limit: batchSize + 1,
          offset,
        });

        const currentHasMore = knowledgeItems.length > batchSize;
        const itemsToProcess = currentHasMore ? knowledgeItems.slice(0, batchSize) : knowledgeItems;
        const filteredItems = filterKnowledgeItems(itemsToProcess, query.knowledgeBaseId).filter(
          (item) => !excludedIdSet.has(item.id),
        );

        for (const item of filteredItems) {
          if (item.sourceType === DERIVED_DOCUMENT_SOURCE_TYPE) {
            documentIds.push(item.documentId ?? item.id);
            continue;
          }

          if (item.documentId) {
            documentIds.push(item.documentId);
            continue;
          }

          fileIds.push(item.fileId ?? item.id);
        }

        offset += itemsToProcess.length;
        hasMore = currentHasMore;
      }

      await assertContentsNotInRestrictedKnowledgeBase(ctx, [...documentIds, ...fileIds]);

      if (documentIds.length > 0) {
        await ctx.documentService.deleteDocuments(documentIds);
      }

      if (fileIds.length > 0) {
        const needToRemoveFileList = await ctx.fileModel.deleteMany(
          fileIds,
          serverDBEnv.REMOVE_GLOBAL_FILE,
        );

        if (needToRemoveFileList && needToRemoveFileList.length > 0) {
          await ctx.fileService.deleteFiles(needToRemoveFileList.map((file) => file.url!));
        }
      }

      return { count: fileIds.length + documentIds.length };
    }),
});
