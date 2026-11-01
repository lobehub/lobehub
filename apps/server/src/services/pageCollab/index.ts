import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';

import type { LobeChatDatabase } from '@/database/type';
import { DocumentService } from '@/server/services/document';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';
import { isSkillMarkdownDocument } from '@/utils/skillMarkdown';

import { isPageCollabEnabled } from './config';
import { DbPageSessions } from './dbSession';
import { RoomPageSessions } from './roomSession';
import { type PageSessions, PageUnsupportedError, type PageWriter } from './session';

export type PageAccess = 'edit' | 'none' | 'view';

/**
 * Page edits go through the live room when collaboration is on, else to the
 * stored row. A SKILL.md never joins a room: its editor saves the frontmatter
 * alongside the body over HTTP, which a room would overwrite. An HTML page has
 * no node tree to edit at all.
 */
export const createPageSessions = (db: LobeChatDatabase, writer: PageWriter): PageSessions => {
  const stored = new DbPageSessions(db, writer);
  const room = isPageCollabEnabled() ? new RoomPageSessions(db, writer) : undefined;
  const documents = new DocumentService(db, writer.userId, writer.workspaceId);

  return {
    openSession: async (documentId, options) => {
      const row = await documents.getDocumentById(documentId);
      if (!row) throw new Error(`Page document not found: ${documentId}`);
      if (row.fileType === HTML_DOCUMENT_FILE_TYPE) throw new PageUnsupportedError();
      if (!room || isSkillMarkdownDocument(row)) return stored.openSession(documentId, options);

      // The room reads and persists with the gateway token and the page owner's
      // scope, so the writer's own permission is the only gate in front of it.
      if ((await resolvePageAccess(db, writer.userId, documentId)) !== 'edit') {
        throw new Error(`No permission to edit page: ${documentId}`);
      }
      return room.openSession(documentId);
    },
  };
};

export const resolvePageAccess = async (
  db: LobeChatDatabase,
  userId: string,
  documentId: string,
): Promise<PageAccess> => {
  const meta = await getResourceMeta(db, 'document', documentId);
  if (!meta) return 'none';
  if (!meta.workspaceId) return meta.userId === userId ? 'edit' : 'none';

  const can = (action: 'edit' | 'view') =>
    canPerformResourceAction({
      action,
      db,
      meta,
      resourceId: documentId,
      resourceType: 'document',
      userId,
      workspaceId: meta.workspaceId!,
    });

  if (await can('edit')) return 'edit';
  return (await can('view')) ? 'view' : 'none';
};

export { isPageCollabEnabled } from './config';
export { editorDataFromRow } from './editorData';
export { openPageFork, projectPageState } from './fork';
export { persistPageState } from './persist';
export { createPageRoomClient } from './roomClient';
export { PageCollabUnavailableError } from './roomSession';
export * from './session';
