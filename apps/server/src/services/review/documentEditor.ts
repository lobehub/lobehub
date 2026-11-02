import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { EditorRuntime } from '@lobechat/editor-runtime';

import { DocumentModel } from '@/database/models/document';
import type { LobeChatDatabase } from '@/database/type';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import {
  createDocumentHeadlessEditor,
  withHeadlessEditorLock,
} from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import {
  replaceTextThroughRoom,
  updateDocumentThroughRoom,
} from '@/server/services/pageCollab/bodyWriter';

import { ReviewServiceError } from './errors';
import { extractDocumentText } from './textExtract';

type EditorRuntimeEditorParam = Parameters<EditorRuntime['setEditor']>[0];

export interface DocumentTextSource {
  content?: string | null;
  documentId: string;
  editorData?: unknown;
  fileType: string;
  /**
   * Version of the body that `content` / `editorData` were read from. Checks
   * capture it before calling the model and compare it again when committing a
   * verdict, so a body that changed mid-evaluation can never be marked passed.
   */
  updatedAt?: Date | null;
}

export const readDocumentTextSource = async (
  documentModel: DocumentModel,
  documentId: string,
): Promise<DocumentTextSource> => {
  const doc = await documentModel.findById(documentId);
  if (!doc) throw new ReviewServiceError('DOCUMENT_NOT_FOUND', 'Document not found');

  return {
    content: doc.content,
    documentId,
    editorData: doc.editorData,
    fileType: doc.fileType,
    updatedAt: doc.updatedAt,
  };
};

export const documentPlainText = (source: DocumentTextSource): string =>
  extractDocumentText({ content: source.content, editorData: source.editorData });

export interface ReplaceTextResult {
  content: string;
  replacementCount: number;
}

/**
 * Apply a single text replacement through the editor's own modification path.
 *
 * This is deliberately the same pipeline the page agent uses: hydrate a headless
 * editor from the stored `editorData` (or Markdown `content`), run
 * `EditorRuntime.replaceText`, then persist the exported state with
 * `saveSource: 'llm_call'` so the change lands as a reviewable history entry and
 * stays undoable in the client editor. The server never string-patches the
 * stored Markdown directly.
 *
 * A page open in a live collaboration room is edited in the room itself
 * ({@link replaceTextThroughRoom}): the row lags the room by the projection
 * delay, so a body rebuilt from the stored row would be diffed against the room
 * and revert whatever was typed in that window. With no live room the write goes
 * through {@link updateDocumentThroughRoom}, which is also how document mutations
 * and agent-document writes land.
 */
export const replaceTextInDocument = async (params: {
  db: LobeChatDatabase;
  documentId: string;
  newText: string;
  searchText: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<ReplaceTextResult> => {
  const { db, documentId, newText, searchText, userId, workspaceId } = params;

  if (!searchText.trim()) {
    throw new ReviewServiceError('ANCHOR_LOST', 'The suggestion has no original text to replace');
  }

  const documentModel = new DocumentModel(db, userId, workspaceId ?? undefined);
  const documentService = new DocumentService(db, userId, workspaceId ?? undefined);

  return documentService.runWithDocumentLock(documentId, async (lockOwnerId) => {
    const source = await readDocumentTextSource(documentModel, documentId);
    if (source.fileType === HTML_DOCUMENT_FILE_TYPE) {
      throw new ReviewServiceError(
        'UNSUPPORTED_DOCUMENT',
        'HTML pages have no node tree; review suggestions cannot be applied',
      );
    }
    if (!isValidEditorData(source.editorData) && !source.content?.trim()) {
      throw new ReviewServiceError('ANCHOR_LOST', 'The document body is empty');
    }

    // A live room is the page: replace the text there so the remaining body keeps
    // whatever was typed since the stored snapshot this read returned.
    const inRoom = await replaceTextThroughRoom(
      db,
      documentId,
      { newText, searchText },
      { saveSource: 'llm_call', userId, workspaceId: workspaceId ?? undefined },
    );

    if (inRoom) {
      // The row this suggestion was validated against can lag the room, so an
      // occurrence typed since then makes the anchor ambiguous in the body that
      // would actually be edited. Refuse instead of rewriting the first match.
      if (inRoom.ambiguous) {
        throw new ReviewServiceError(
          'ANCHOR_AMBIGUOUS',
          'The suggestion original text now appears more than once in the page; edit it to disambiguate before applying',
        );
      }

      if (inRoom.replacementCount === 0) {
        throw new ReviewServiceError(
          'ANCHOR_LOST',
          'The suggestion original text can no longer be located in the document',
        );
      }

      return inRoom;
    }

    const applied = await withHeadlessEditorLock(async () => {
      const editor = createDocumentHeadlessEditor();
      try {
        if (isValidEditorData(source.editorData)) {
          editor.hydrateEditorData(source.editorData as any, { keepId: true });
        } else {
          editor.hydrateMarkdown(source.content!, { keepId: true });
        }

        const runtime = new EditorRuntime();
        runtime.setEditor(editor.kernel as unknown as EditorRuntimeEditorParam);
        runtime.setCurrentDocId(documentId);

        const result = await runtime.replaceText({
          newText,
          replaceAll: false,
          searchText,
        });
        const exported = editor.export();

        return {
          content: exported.markdown,
          editorData: exported.editorData as unknown as Record<string, unknown>,
          replacementCount: result.replacementCount,
        };
      } finally {
        editor.destroy();
      }
    });

    if (applied.replacementCount === 0) {
      throw new ReviewServiceError(
        'ANCHOR_LOST',
        'The suggestion original text can no longer be located in the document',
      );
    }

    await updateDocumentThroughRoom(
      db,
      documentService,
      documentId,
      {
        content: applied.content,
        editorData: applied.editorData,
        ...(lockOwnerId ? { lockOwnerId } : {}),
        saveSource: 'llm_call',
      },
      { userId, workspaceId: workspaceId ?? undefined },
    );

    return { content: applied.content, replacementCount: applied.replacementCount };
  });
};
