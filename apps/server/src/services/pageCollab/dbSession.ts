import isEqual from 'fast-deep-equal';

import type { LobeChatDatabase } from '@/database/type';
import { createDocumentHeadlessEditor } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';

import { editorDataFromRow, toStoredMarkdown } from './editorData';
import {
  historyAttributionOf,
  type OpenPageSessionOptions,
  PageChangedError,
  type PageSession,
  type PageSessions,
  type PageWriter,
  toPageChangedError,
} from './session';

const NO_ID_REMAP = new Map<string, string>();

/**
 * Edits the stored page directly, for deployments without collaboration rooms.
 * A commit only lands on the version the session read: a page saved in between
 * fails the commit instead of being overwritten, and the tool tells the model
 * to read the page again.
 */
export class DbPageSessions implements PageSessions {
  private readonly documentService: DocumentService;

  constructor(
    db: LobeChatDatabase,
    private readonly writer: PageWriter,
  ) {
    this.documentService = new DocumentService(db, writer.userId, writer.workspaceId);
  }

  async openSession(documentId: string, options?: OpenPageSessionOptions): Promise<PageSession> {
    const row = await this.documentService.getDocumentById(documentId);
    if (!row) throw new Error(`Page document not found: ${documentId}`);
    const version = row.updatedAt.toISOString();
    if (options?.expectedVersion && options.expectedVersion !== version) {
      throw new PageChangedError('changed');
    }

    const editor = createDocumentHeadlessEditor();
    const stored = editorDataFromRow(row);
    // `keepId` restores the stored node ids, so LiteXML ids match across sessions.
    if (stored) editor.hydrateEditorData(stored, { keepId: true });

    const initialBody = editor.export().editorData;
    const initialTitle = row.title ?? 'Untitled';
    let nextTitle = initialTitle;

    return {
      commit: async () => {
        const { editorData, markdown } = editor.export();
        const bodyChanged = !isEqual(editorData, initialBody);
        const titleChanged = nextTitle !== initialTitle;
        if (!bodyChanged && !titleChanged) return false;

        try {
          await this.documentService.updateDocument(documentId, {
            ...(bodyChanged
              ? {
                  content: toStoredMarkdown(row, markdown),
                  editorData: editorData as unknown as Record<string, unknown>,
                }
              : {}),
            ...(titleChanged ? { title: nextTitle } : {}),
            expectedUpdatedAt: row.updatedAt,
            history: historyAttributionOf(this.writer),
            saveSource: this.writer.saveSource,
            writeSource: this.writer.writeSource,
          });
        } catch (error) {
          throw toPageChangedError(error) ?? error;
        }
        return true;
      },
      draft: { destroy: () => editor.destroy(), editor, stableIds: () => NO_ID_REMAP },
      setTitle: (title) => {
        nextTitle = title;
      },
      title: initialTitle,
      version,
    };
  }
}
