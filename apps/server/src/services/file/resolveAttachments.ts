import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatAudioItem, ChatFileItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';
import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';

const log = debug('lobe-server:resolveAttachments');

export interface ResolvedAttachments {
  audioList: ChatAudioItem[];
  fileList: ChatFileItem[];
  imageList: ChatImageItem[];
  /**
   * The subset of caller-provided fileIds that were successfully resolved,
   * in caller order. Use this when storing the file→message relation so it
   * matches the order the user uploaded.
   */
  orderedFileIds: string[];
  videoList: ChatVideoItem[];
  warnings: string[];
}

interface ResolveArgs {
  db: LobeChatDatabase;
  fileIds: string[];
  userId: string;
  workspaceId?: string;
}

const dedupe = (ids: string[]) => Array.from(new Set(ids));

/**
 * Resolve fileIds into image/video/file lists for the LLM prompt layer.
 *
 * Images and videos return as-is with a signed URL. Non-media files are
 * parsed via `DocumentService.parseFile` (idempotent) so their text content
 * can be injected by `filesPrompts()`. Missing or unparseable files are
 * skipped and reported in `warnings`.
 */
export const resolveAttachmentsByFileIds = async ({
  db,
  fileIds,
  userId,
  workspaceId,
}: ResolveArgs): Promise<ResolvedAttachments> => {
  const result: ResolvedAttachments = {
    audioList: [],
    fileList: [],
    imageList: [],
    orderedFileIds: [],
    videoList: [],
    warnings: [],
  };
  if (fileIds.length === 0) return result;

  const dedupedFileIds = dedupe(fileIds);
  const fileModel = new FileModel(db, userId, workspaceId);
  const fileService = new FileService(db, userId, workspaceId);
  const fileRecords = await fileModel.findByIds(dedupedFileIds);
  if (fileRecords.length === 0) {
    log('no file records found for fileIds=%O', dedupedFileIds);
    return result;
  }

  const documentService = new DocumentService(db, userId, workspaceId);
  const recordById = new Map(fileRecords.map((f) => [f.id, f]));

  // Resolve every file in parallel — URL signing + PDF parsing can both be
  // I/O-bound, and a serial loop made every extra attachment add latency
  // before the agent could start running.
  const resolved = await Promise.all(
    dedupedFileIds.map(async (id) => {
      const file = recordById.get(id);
      if (!file) {
        return { id, missing: true as const };
      }
      const resolvedUrl = (await fileService.getFullFileUrl(file.url)) || file.url;
      const fileType = file.fileType || '';
      if (
        fileType.startsWith('image') ||
        fileType.startsWith('video') ||
        fileType.startsWith('audio')
      ) {
        return { file, fileType, id, resolvedUrl };
      }
      let content: string | undefined;
      let parseError: unknown;
      try {
        const document = await documentService.parseFile(file.id);
        content = document.content ?? undefined;
      } catch (error) {
        parseError = error;
      }
      return { content, file, fileType, id, parseError, resolvedUrl };
    }),
  );

  for (const entry of resolved) {
    if ('missing' in entry) {
      result.warnings.push(`Attachment "${entry.id}" was not found and skipped.`);
      continue;
    }
    const { file, fileType, resolvedUrl } = entry;
    result.orderedFileIds.push(file.id);
    if (fileType.startsWith('image')) {
      result.imageList.push({ alt: file.name || 'image', id: file.id, url: resolvedUrl });
      continue;
    }
    if (fileType.startsWith('video')) {
      result.videoList.push({ alt: file.name || 'video', id: file.id, url: resolvedUrl });
      continue;
    }
    if (fileType.startsWith('audio')) {
      result.audioList.push({ alt: file.name || 'audio', id: file.id, url: resolvedUrl });
      continue;
    }
    if (entry.parseError) {
      log('parseFile failed for %s (id=%s): %O', file.name, file.id, entry.parseError);
      result.warnings.push(
        `File "${file.name || 'unknown'}" was attached but its contents could not be extracted.`,
      );
    }
    result.fileList.push({
      content: entry.content,
      fileType: fileType || 'application/octet-stream',
      id: file.id,
      name: file.name || 'file',
      size: file.size ?? 0,
      url: resolvedUrl,
    });
  }

  log(
    'resolved %d attachment(s) (%d images, %d videos, %d audios, %d documents)',
    fileRecords.length,
    result.imageList.length,
    result.videoList.length,
    result.audioList.length,
    result.fileList.length,
  );

  return result;
};

/**
 * Metadata-only resolver for UI rendering (CommentCard, TaskInstruction) and
 * prompt rendering (buildTaskPrompt). Skips `DocumentService.parseFile` so it
 * stays fast and does not block on large PDFs. Items returned in caller order;
 * missing files are dropped.
 *
 * Pass `signUrls: false` when the caller doesn't need playable URLs (e.g.
 * prompt rendering only uses name + fileType) — saves N presigned-URL fetches.
 */
export const resolveAttachmentMetadata = async ({
  db,
  fileIds,
  signUrls = true,
  userId,
  workspaceId,
}: ResolveArgs & { signUrls?: boolean }): Promise<ChatFileItem[]> => {
  if (fileIds.length === 0) return [];

  const dedupedFileIds = dedupe(fileIds);
  const fileModel = new FileModel(db, userId, workspaceId);
  const fileRecords = await fileModel.findByIds(dedupedFileIds);
  if (fileRecords.length === 0) {
    log('no file records found for fileIds=%O', dedupedFileIds);
    return [];
  }

  const fileService = signUrls ? new FileService(db, userId, workspaceId) : null;
  const recordById = new Map(fileRecords.map((f) => [f.id, f]));
  const items = await Promise.all(
    dedupedFileIds.map(async (id) => {
      const file = recordById.get(id);
      if (!file) return undefined;
      const url = fileService ? (await fileService.getFullFileUrl(file.url)) || file.url : file.url;
      return {
        fileType: file.fileType || 'application/octet-stream',
        id: file.id,
        name: file.name || 'file',
        size: file.size ?? 0,
        url,
      } satisfies ChatFileItem;
    }),
  );
  return items.filter((it): it is ChatFileItem => !!it);
};
