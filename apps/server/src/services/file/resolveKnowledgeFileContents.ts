import type { LobeChatDatabase } from '@lobechat/database';
import { type FileContent, isOversizedFileContent } from '@lobechat/prompts';
import debug from 'debug';

import { readOriginalCharCount } from '@/database/utils/parsedDocument';
import { DocumentService } from '@/server/services/document';

const log = debug('lobe-server:resolveKnowledgeFileContents');

export interface KnowledgeFileItem {
  content?: string | null;
  enabled?: boolean | null;
  fileType?: string | null;
  id?: string;
  name?: string | null;
  originalCharCount?: number;
}

const isMediaFileType = (fileType?: string | null): boolean => {
  const type = fileType || '';
  return type.startsWith('image') || type.startsWith('video') || type.startsWith('audio');
};

/**
 * Whether the text this resolver sends for a knowledge file may be cut to a preview.
 *
 * Tool discovery runs before the context builder, so a file that is resolved on demand
 * still has no content there and its length is unknown. Treating it as possibly
 * oversized keeps `readAttachment` in the tool set on the turn that parses it; otherwise
 * the model would get a truncated preview with no way to read the rest.
 */
export const mayBeOversizedKnowledgeFile = (file: KnowledgeFileItem): boolean => {
  if (file.enabled !== true) return false;
  if (typeof file.content === 'string') {
    return isOversizedFileContent(file.content.length, file.originalCharCount);
  }
  return !!file.id && !isMediaFileType(file.fileType);
};

interface ResolveKnowledgeArgs {
  db: LobeChatDatabase;
  files?: KnowledgeFileItem[] | null;
  userId?: string;
  workspaceId?: string;
}

/**
 * Resolve the agent's enabled knowledge files into prompt-ready contents.
 *
 * The agent config carries the cached `documents.content` for each enabled
 * file, but a file whose parse never ran (or failed at upload time) arrives
 * with a null content and used to be injected as an empty `<file>` block —
 * which the model reads as a missing attachment, with no hint to the user
 * about what went wrong. Mirror the message-attachment path
 * (`resolveAttachmentsByFileIds`): parse on demand through the idempotent
 * `DocumentService.parseFile`, and report a parse failure through the
 * prompt's existing `error` attribute instead of failing silently.
 */
export const resolveKnowledgeFileContents = async ({
  db,
  files,
  userId,
  workspaceId,
}: ResolveKnowledgeArgs): Promise<FileContent[]> => {
  const enabledFiles = (files ?? []).filter((file) => file.enabled === true);
  if (enabledFiles.length === 0) return [];

  let documentService: DocumentService | undefined;
  // The same file can be mounted by several workspace members (the junction
  // key is fileId + agentId + userId), so it can appear here more than once;
  // sharing one parse promise per file id keeps a single parseFile call from
  // racing itself into duplicate document rows.
  const parsePromises = new Map<string, ReturnType<DocumentService['parseFile']>>();

  // Parse in parallel for the same reason resolveAttachmentsByFileIds does:
  // each parse is I/O-bound and a serial loop would stack their latencies.
  return Promise.all(
    enabledFiles.map(async (file): Promise<FileContent> => {
      const base: FileContent = {
        content: file.content ?? '',
        fileId: file.id ?? '',
        filename: file.name ?? '',
        originalChars: file.originalCharCount,
      };
      const isMedia = isMediaFileType(file.fileType);
      // A cached parse passes through even when it is empty; media files have
      // no text to extract (the attachment path skips them the same way); and
      // without a file id or a user id there is no document scope to parse
      // under, so those keep the previous shape.
      if (typeof file.content === 'string' || !file.id || !userId || isMedia) return base;

      documentService ??= new DocumentService(db, userId, workspaceId);
      try {
        let parsePromise = parsePromises.get(file.id);
        if (!parsePromise) {
          parsePromise = documentService.parseFile(file.id);
          parsePromises.set(file.id, parsePromise);
        }
        const document = await parsePromise;
        return {
          ...base,
          content: document.content ?? '',
          originalChars: readOriginalCharCount(document.metadata),
        };
      } catch (error) {
        log('parseFile failed for %s (id=%s): %O', file.name, file.id, error);
        return {
          ...base,
          error: 'The file is attached but its contents could not be extracted.',
        };
      }
    }),
  );
};
