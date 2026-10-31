import type { ChatAudioItem, ChatImageItem } from '@lobechat/types';
import { readAudioDurationMs } from '@lobechat/utils';
import { isPlainRecord } from '@lobechat/utils/object';
import { asc } from 'drizzle-orm';

import { documents } from '../../schemas';
import { documentOriginalCharCount } from '../../utils/originalCharCount';

/**
 * Max concurrent `postProcessUrl` calls (file URL presign/transform) while
 * hydrating the attachments of a message page.
 */
export const FILE_URL_POST_PROCESS_CONCURRENCY = 10;

export const fileDocumentColumns = {
  content: documents.content,
  fileId: documents.fileId,
  originalCharCount: documentOriginalCharCount().mapWith(Number),
};

/**
 * A file can own more than one document (`parseDocument` writes a page-editor copy next to the parse
 * cache). Every reader picks the oldest, matching `DocumentModel.findByFileId`, so a preview and the
 * `readAttachment` pages that continue it come from the same text.
 */
export const fileDocumentsOrder = [asc(documents.createdAt), asc(documents.id)];

export type FileDocumentsMap = Record<string, { content: string; originalCharCount?: number }>;

export const toFileDocumentsMap = (
  rows: { content: string | null; fileId: string | null; originalCharCount: number | null }[],
): FileDocumentsMap =>
  rows.reduce<FileDocumentsMap>((acc, doc) => {
    // Rows arrive oldest first (see `fileDocumentsOrder`); keep the first so the prompt shows the
    // same document `DocumentModel.findByFileId` — and therefore `readAttachment` — pages through.
    if (doc.fileId && !(doc.fileId in acc)) {
      acc[doc.fileId] = {
        content: doc.content as string,
        originalCharCount: doc.originalCharCount ?? undefined,
      };
    }
    return acc;
  }, {});

export const createChatImageItem = ({
  fileType,
  id,
  metadata,
  name,
  url,
}: {
  fileType?: string | null;
  id: string;
  metadata: unknown;
  name: string;
  url: string;
}): ChatImageItem => {
  const imageMetadata = isPlainRecord(metadata) ? metadata : {};
  const toPositiveNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  const height = toPositiveNumber(imageMetadata.height);
  const ratio = toPositiveNumber(imageMetadata.ratio);
  const width = toPositiveNumber(imageMetadata.width);

  return {
    alt: name,
    ...(height && { height }),
    id,
    ...(fileType && { mimeType: fileType }),
    ...(ratio && { ratio }),
    url,
    ...(width && { width }),
  };
};

/**
 * Read the operation-final Work root id stamped on a message's metadata by the
 * Work registry (`metadata.work.rootOperationId`). Mirrors the client-side
 * `getOperationFinalRootId` without importing from the app layer.
 */
export const getMessageWorkRootId = (metadata: unknown): string | undefined => {
  const rootOperationId = (metadata as { work?: { rootOperationId?: unknown } } | null)?.work
    ?.rootOperationId;
  return typeof rootOperationId === 'string' && rootOperationId ? rootOperationId : undefined;
};

export interface MessageRelatedFile {
  fileType: string | null;
  id: string;
  messageId: string;
  metadata: unknown;
  name: string | null;
  size: number | null;
  url: string;
}

export const materializeChatAudioItem = ({
  fileType,
  id,
  metadata,
  name,
  url,
}: MessageRelatedFile): ChatAudioItem => {
  const value = isPlainRecord(metadata) ? metadata : {};
  const durationMs = readAudioDurationMs(metadata);

  return {
    alt: name!,
    ...(typeof value.codec === 'string' ? { codec: value.codec } : {}),
    ...(durationMs === undefined ? {} : { durationMs }),
    id,
    ...(typeof value.mimeType === 'string'
      ? { mimeType: value.mimeType }
      : fileType
        ? { mimeType: fileType }
        : {}),
    url,
  };
};
