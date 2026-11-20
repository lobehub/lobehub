import { createHash } from 'node:crypto';

import type { DocumentWriteSource } from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { withHeadlessEditorLock } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import type {
  DocumentHistoryAttribution,
  DocumentHistorySaveSource,
} from '@/server/services/document/types';
import { redisService } from '@/server/services/redis';
import { getResourceMeta } from '@/server/services/resourcePermission';

import { toStoredMarkdown } from './editorData';
import { projectPageState } from './fork';

const log = debug('lobe-server:page-collab:persist');

// jsonb does not keep key order, so the digest sorts keys first.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
};

const bodyDigest = (editorData: unknown) =>
  createHash('sha1')
    .update(JSON.stringify(canonical(editorData ?? null)))
    .digest('hex');

export class PageProjectionRejectedError extends Error {
  constructor(documentId: string, reason = 'the room holds blocks the projection lost') {
    super(`Refusing to persist page ${documentId}: ${reason}`);
    this.name = 'PageProjectionRejectedError';
  }
}

/**
 * Writes a room state to the stored page, the one place a collaborative page's
 * body reaches the `documents` row. The saved version is recorded under
 * `saveSource`, attributed to `history`.
 */
export const persistPageState = async (
  db: LobeChatDatabase,
  documentId: string,
  state: Uint8Array,
  options: {
    history?: DocumentHistoryAttribution;
    saveSource: DocumentHistorySaveSource;
    /**
     * Who wrote the room's latest changes; decides whether the per-document
     * character limit applies. The room's own projection carries browser edits,
     * so it defaults to `user`.
     */
    writeSource?: DocumentWriteSource;
  },
): Promise<boolean> => {
  const meta = await getResourceMeta(db, 'document', documentId);
  if (!meta) return false;

  const { editorData, erasedBody, lostBlocks, markdown, title } = await withHeadlessEditorLock(() =>
    projectPageState(state),
  );
  // A binding that fails to read the room exports an empty page; writing it
  // would erase the stored body and the version history's latest state.
  if (lostBlocks) throw new PageProjectionRejectedError(documentId);

  const service = new DocumentService(db, meta.userId, meta.workspaceId ?? undefined);
  const row = await service.getDocumentById(documentId);
  if (!row) return false;

  // An empty room that never erased anything never received the stored body,
  // e.g. a seed whose body push was lost. Projecting it would blank the page.
  if (!markdown.trim() && !erasedBody && row.content?.trim()) {
    throw new PageProjectionRejectedError(documentId, 'the room never received the stored body');
  }

  // Every known writer of a room page's body goes through its room. A body that
  // changed since the last projection was written around it anyway; keep that
  // version as its own `system` entry in the history before the room replaces it.
  const lastProjected = await redisService.pageCollab.lastProjectedBody(documentId);
  const writtenOutsideRoom = lastProjected !== null && lastProjected !== bodyDigest(row.editorData);
  if (writtenOutsideRoom) log('page %s body was written outside its room', documentId);

  // A projection that drops most of the body may be a real delete or a room
  // that lost its content; either way the previous body stays recoverable.
  const previousLength = row.content?.length ?? 0;
  if (previousLength > 0 && markdown.length * 2 < previousLength) {
    console.warn(
      '[page-collab] room %s shrank the page from %d to %d characters',
      documentId,
      previousLength,
      markdown.length,
    );
    await service.trySaveCurrentDocumentHistory(documentId, 'system');
  }

  await service.updateDocument(documentId, {
    content: toStoredMarkdown(row, markdown),
    editorData: editorData as unknown as Record<string, unknown>,
    history: options.history,
    origin: 'room-projection',
    writeSource: options.writeSource,
    ...(writtenOutsideRoom
      ? { breakAutosaveWindow: true, saveSource: 'system' as const }
      : { saveSource: options.saveSource }),
    ...(title ? { title } : {}),
  });
  await redisService.pageCollab.rememberProjectedBody(documentId, bodyDigest(editorData));
  return true;
};
