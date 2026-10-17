import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { READABLE_URL_BATCH_SIZE } from '@/const/readableFileUrls';
import type { FileModel } from '@/database/models/file';
import type { FileService } from '@/server/services/file';

import type { KnowledgeBaseAccessCtx } from '../_helpers/knowledgeBaseAccess';
import {
  assertContentsNotInRestrictedKnowledgeBase,
  assertFileNotInRestrictedKnowledgeBase,
} from '../_helpers/knowledgeBaseAccess';

interface ReadableUrlContext extends KnowledgeBaseAccessCtx {
  fileModel: Pick<FileModel, 'findById' | 'findByIds'>;
  fileService: Pick<FileService, 'getFullFileUrl'>;
}

export const readableUrlsInput = z.object({
  ids: z.array(z.string()).max(READABLE_URL_BATCH_SIZE),
});

/** Direct storage URLs avoid cross-origin redirects through the application proxy. */
export const getReadableUrl = async (ctx: ReadableUrlContext, id: string) => {
  const item = await ctx.fileModel.findById(id);
  if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
  await assertFileNotInRestrictedKnowledgeBase(ctx, id);
  return { url: await ctx.fileService.getFullFileUrl(item.url) };
};

export const getReadableUrls = async (ctx: ReadableUrlContext, inputIds: string[]) => {
  const ids = [...new Set(inputIds)];
  if (ids.length === 0) return {};
  // findByIds applies the same ownership and access scope as findById.
  const files = await ctx.fileModel.findByIds(ids);
  const accessibleIds = new Set(files.map((file) => file.id));
  if (ids.some((id) => !accessibleIds.has(id))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
  }
  await assertContentsNotInRestrictedKnowledgeBase(ctx, ids);
  const entries = await pMap(
    files,
    async (file) => [file.id, await ctx.fileService.getFullFileUrl(file.url)] as const,
    { concurrency: 8 },
  );
  return Object.fromEntries(entries);
};
