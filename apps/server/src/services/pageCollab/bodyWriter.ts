import {
  alignLiteXMLBlocks,
  diffLiteXMLBlocks,
  type ModifyOperation,
} from '@lobechat/editor-runtime';
import type { HeadlessEditor, HeadlessLiteXMLOperation } from '@lobehub/editor/headless';

import type { LobeChatDatabase } from '@/database/type';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import {
  createDocumentHeadlessEditor,
  withHeadlessEditorLock,
} from '@/server/services/agentDocuments/headlessEditor';
import type { DocumentService } from '@/server/services/document';
import type { UpdateDocumentParams, UpdateDocumentResult } from '@/server/services/document/types';

import { isPageCollabEnabled } from './config';
import type { SerializedEditor } from './editorData';
import { runPageExclusive } from './queue';
import { RoomPageSessions } from './roomSession';
import type { PageWriter } from './session';

export interface PageBody {
  editorData?: unknown;
  markdown?: string;
  /** The room carries the title too; one written only to the row would be projected over. */
  title?: string;
}

const toHeadlessOperation = (operation: ModifyOperation): HeadlessLiteXMLOperation => {
  if (operation.action === 'modify') return { action: 'replace', litexml: operation.litexml };
  return operation as HeadlessLiteXMLOperation;
};

const bodyEditorOf = (body: PageBody) => {
  const editor = createDocumentHeadlessEditor();
  if (isValidEditorData(body.editorData)) {
    editor.hydrateEditorData(body.editorData as unknown as SerializedEditor, { keepId: true });
  } else if (body.markdown?.trim()) {
    editor.hydrateMarkdown(body.markdown, { keepId: true });
  }
  return editor;
};

// Moves the room's page to `body` with the smallest block change.
const applyBody = async (editor: HeadlessEditor, body: PageBody) => {
  const target = bodyEditorOf(body);
  try {
    const currentXml = editor.export({ litexml: true }).litexml ?? '';
    const aligned = alignLiteXMLBlocks(currentXml, target.export({ litexml: true }).litexml ?? '');
    const diff = aligned ? diffLiteXMLBlocks(currentXml, aligned) : undefined;

    if (!diff?.ok) {
      // An empty room, or a body that is not block LiteXML: replace it whole.
      editor.hydrateEditorData(target.export().editorData, { keepId: true });
    } else if (diff.operations.length > 0) {
      await editor.applyLiteXML(diff.operations.map(toHeadlessOperation));
    }
  } finally {
    target.destroy();
  }
};

/**
 * Writes a page body that a server-side writer (the CLI, an agent tool, a
 * rollback, a client that predates rooms) would otherwise put straight into the
 * `documents` row. A page with a live room projects the room over that row, so
 * the write would be lost; it goes into the room instead, as the smallest block
 * change, and merges with whatever people type meanwhile.
 *
 * Resolves false when the page has no live room: the caller writes the row as
 * before, and a room opened later seeds itself from it.
 */
export const writePageBodyThroughRoom = async (
  db: LobeChatDatabase,
  documentId: string,
  body: PageBody,
  writer: PageWriter,
): Promise<boolean> => {
  if (!isPageCollabEnabled()) return false;

  return runPageExclusive(documentId, () =>
    withHeadlessEditorLock(async () => {
      const session = await new RoomPageSessions(db, writer).openLiveSession(documentId);
      if (!session) return false;

      try {
        if (body.editorData !== undefined || body.markdown !== undefined) {
          await applyBody(session.draft.editor, body);
        }
        if (body.title !== undefined && body.title !== session.title) session.setTitle(body.title);

        await session.commit();
        return true;
      } finally {
        session.draft.destroy();
      }
    }),
  );
};

/**
 * {@link DocumentService.updateDocument} for writers outside the page editor:
 * the body and title go through the page's live room when it has one, and the
 * rest of the update still lands on the row.
 */
export const updateDocumentThroughRoom = async (
  db: LobeChatDatabase,
  service: Pick<DocumentService, 'updateDocument'>,
  documentId: string,
  params: UpdateDocumentParams,
  writer: Omit<PageWriter, 'saveSource' | 'writeSource'>,
): Promise<UpdateDocumentResult> => {
  const writesRoom =
    params.content !== undefined || params.editorData !== undefined || params.title !== undefined;
  if (!writesRoom || params.origin === 'room-projection') {
    return service.updateDocument(documentId, params);
  }

  const routed = await writePageBodyThroughRoom(
    db,
    documentId,
    { editorData: params.editorData, markdown: params.content, title: params.title },
    {
      ...writer,
      saveSource: params.saveSource ?? 'system',
      writeSource: params.writeSource ?? 'user',
    },
  );
  if (!routed) return service.updateDocument(documentId, params);

  // The room merged and persisted the body (and title); the version predicate
  // guarded a row write that no longer happens.
  const {
    content: _content,
    editorData: _editorData,
    expectedUpdatedAt: _expectedUpdatedAt,
    title: _title,
    ...rest
  } = params;
  return service.updateDocument(documentId, rest);
};

/**
 * Stores a page's live room state as a version (a manual save, accepting AI
 * suggestions). The client already wrote the edits into the room; this only
 * records them. Resolves false when the page has no live room.
 */
export const snapshotPageThroughRoom = async (
  db: LobeChatDatabase,
  documentId: string,
  writer: PageWriter,
): Promise<boolean> => {
  if (!isPageCollabEnabled()) return false;

  return runPageExclusive(documentId, () =>
    withHeadlessEditorLock(async () => {
      const session = await new RoomPageSessions(db, writer).openLiveSession(documentId);
      if (!session) return false;
      try {
        await session.persistAs(writer.saveSource);
        return true;
      } finally {
        session.draft.destroy();
      }
    }),
  );
};
