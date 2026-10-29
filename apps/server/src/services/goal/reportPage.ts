import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';

import { DocumentModel } from '@/database/models/document';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentService } from '../document';

interface ReportPageOwner {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

interface WriteReportPageParams {
  html: string;
  /** The page an earlier report version wrote; reused so a Goal keeps one report page. */
  previousPageId?: string;
  title: string;
}

/**
 * Store a report version as an HTML page (a `custom/html` document, rendered in
 * a sandboxed frame). A Goal keeps one report page: a later version rewrites the
 * page an earlier one created, unless that page is gone, no longer HTML, or
 * cannot be written (e.g. a member holds its edit lock) — then a new page is
 * created. Workspace pages are shared like the report itself.
 */
export const writeGoalReportPage = async (
  { db, userId, workspaceId }: ReportPageOwner,
  { html, previousPageId, title }: WriteReportPageParams,
): Promise<string> => {
  const documentService = new DocumentService(db, userId, workspaceId);

  if (previousPageId) {
    const previous = await new DocumentModel(db, userId, workspaceId).findById(previousPageId);
    if (previous?.fileType === HTML_DOCUMENT_FILE_TYPE) {
      const updated = await documentService
        .updateDocument(previousPageId, { content: html, saveSource: 'llm_call', title })
        .then(() => true)
        .catch((error) => {
          console.warn('[GoalReportPage] could not rewrite the previous page:', error);
          return false;
        });
      if (updated) return previousPageId;
    }
  }

  const page = await documentService.createDocument({
    content: html,
    fileType: HTML_DOCUMENT_FILE_TYPE,
    title,
    ...(workspaceId ? { visibility: 'public' as const } : {}),
  });
  if (workspaceId && page.visibility !== 'private') {
    await new ResourcePermissionModel(db, workspaceId).setAccessLevel(
      'document',
      page.id,
      DEFAULT_RESOURCE_ACCESS_LEVELS.document,
      userId,
    );
  }
  return page.id;
};
