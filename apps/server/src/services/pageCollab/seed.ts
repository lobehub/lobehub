import * as Y from 'yjs';

import type { LobeChatDatabase } from '@/database/type';
import { withHeadlessEditorLock } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import { getResourceMeta } from '@/server/services/resourcePermission';

import { editorDataFromRow, type SerializedEditor } from './editorData';
import { openPageFork, PAGE_META_KEY } from './fork';

export type PageSeed =
  | { status: 'ok'; update: Uint8Array; workspaceId: string }
  | { status: 'not_allowed' | 'not_found' };

export interface PageRoomStatus {
  exists: boolean;
  inWorkspace: boolean;
  workspaceId: string | null;
}

// The room asks for its seed once, so it is the only tree the page ever has;
// an empty page still needs a root, or the next writer would create a second one.
export const emptyEditorData = (): SerializedEditor =>
  ({
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          type: 'paragraph',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }) as unknown as SerializedEditor;

export const buildPageSeed = async (
  db: LobeChatDatabase,
  documentId: string,
): Promise<PageSeed> => {
  const meta = await getResourceMeta(db, 'document', documentId);
  if (!meta) return { status: 'not_found' };
  if (!meta.workspaceId) return { status: 'not_allowed' };

  const row = await new DocumentService(db, meta.userId, meta.workspaceId).getDocumentById(
    documentId,
  );
  if (!row) return { status: 'not_found' };
  const workspaceId = meta.workspaceId;

  return withHeadlessEditorLock(async () => {
    const seed = await openPageFork(undefined, editorDataFromRow(row) ?? emptyEditorData());
    try {
      if (row.title) seed.doc.getMap(PAGE_META_KEY).set('title', row.title);
      return { status: 'ok', update: Y.encodeStateAsUpdate(seed.doc), workspaceId };
    } finally {
      seed.destroy();
    }
  });
};

export const getPageRoomStatus = async (
  db: LobeChatDatabase,
  documentId: string,
): Promise<PageRoomStatus> => {
  const meta = await getResourceMeta(db, 'document', documentId);
  const workspaceId = meta?.workspaceId ?? null;
  return { exists: !!meta, inWorkspace: !!workspaceId, workspaceId };
};
