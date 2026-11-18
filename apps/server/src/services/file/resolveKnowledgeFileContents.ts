import type { LobeChatDatabase } from '@lobechat/database';
import { type FileContent, isOversizedFileContent } from '@lobechat/prompts';
import debug from 'debug';

import { readOriginalCharCount } from '@/database/utils/parsedDocument';
import { DocumentService } from '@/server/services/document';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

const log = debug('lobe-server:resolveKnowledgeFileContents');
const PARSE_WAIT_MS = 5_000;
const RETRY_AFTER_MS = 5 * 60_000;
const PARSE_FAILED = 'The file is attached but its contents could not be extracted.';
const STILL_PROCESSING =
  'The file is attached but is still being processed; its contents are not available for this message.';

type ParseResult = Pick<FileContent, 'content' | 'error' | 'originalChars'>;
interface SharedParse {
  failed: boolean;
  scheduled: boolean;
  task: Promise<void>;
  waiters: Set<(result: ParseResult) => void>;
}
const parseCaches = new WeakMap<LobeChatDatabase, Map<string, SharedParse>>();

const scopeKey = (userId: string, workspaceId: string | undefined, fileId: string) =>
  JSON.stringify([userId, workspaceId, fileId]);

/** Expose only parse status. Callers must enforce their own access and read cached text first. */
export const getKnowledgeFileParsePlaceholder = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  fileId: string,
): string | undefined => {
  const parse = parseCaches.get(db)?.get(scopeKey(userId, workspaceId, fileId));
  if (!parse) return;
  return parse.failed ? PARSE_FAILED : STILL_PROCESSING;
};

const waitForParse = (parse: SharedParse): Promise<ParseResult> => {
  if (parse.failed) return Promise.resolve({ content: '', error: PARSE_FAILED });

  return new Promise((resolve) => {
    const finish = (result: ParseResult) => {
      clearTimeout(timeout);
      parse.waiters.delete(finish);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      if (!parse.scheduled) {
        parse.scheduled = true;
        // The cloud invocation can finish the response before parsing ends.
        // Let the host keep the parse alive outside the inline step's clock.
        afterUnscoped(() => parse.task);
      }
      finish({ content: '', error: STILL_PROCESSING });
    }, PARSE_WAIT_MS);
    parse.waiters.add(finish);
  });
};

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
  // The same file and caller can have several mounts or overlapping calls.
  // Keep in-flight work and short-lived failures together, scoped to the
  // database and the caller's effective user/workspace authorization.
  let cache = parseCaches.get(db);
  if (!cache) {
    cache = new Map();
    parseCaches.set(db, cache);
  }
  const scopedParses = cache;
  const requestParses = new Map<string, Promise<ParseResult>>();

  const parse = (fileId: string, caller: string): SharedParse => {
    const key = scopeKey(caller, workspaceId, fileId);
    const existing = scopedParses.get(key);
    if (existing) return existing;

    documentService ??= new DocumentService(db, caller, workspaceId);
    const settle = (result: ParseResult) => {
      for (const waiter of pending.waiters) waiter(result);
    };
    const pending: SharedParse = {
      failed: false,
      scheduled: false,
      task: documentService.parseFile(fileId).then(
        (document) => {
          scopedParses.delete(key);
          settle({
            content: document.content ?? '',
            originalChars: readOriginalCharCount(document.metadata),
          });
        },
        (error: unknown) => {
          log('parseFile failed for id=%s: %O', fileId, error);
          pending.failed = true;
          // Server processes outlive user sessions, so permission errors also
          // expire here and can recover after access is granted.
          setTimeout(() => scopedParses.delete(key), RETRY_AFTER_MS).unref?.();
          settle({ content: '', error: PARSE_FAILED });
        },
      ),
      waiters: new Set(),
    };
    scopedParses.set(key, pending);
    return pending;
  };

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

      let pending = requestParses.get(file.id);
      if (!pending) {
        pending = waitForParse(parse(file.id, userId));
        requestParses.set(file.id, pending);
      }
      return { ...base, ...(await pending) };
    }),
  );
};
