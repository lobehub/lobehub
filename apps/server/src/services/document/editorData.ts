import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import { createMarkdownEditorSnapshot } from '../agentDocuments/headlessEditor';

interface ResolveDocumentEditorDataParams {
  content?: string;
  editorData?: Record<string, any>;
  fileType?: string;
}

/**
 * Resolve the editorData to persist alongside a Markdown `content` write.
 *
 * Clients that cannot build Lexical state (the CLI) send only content, and older
 * CLI builds sent `{ type: 'doc', content }`. Persisting either leaves every
 * reader to re-parse Markdown, which mints new node ids on each read, so the ids
 * an agent reads are gone by the time it edits nodes by id. Build real Lexical
 * state from the content instead; valid editorData is kept as-is.
 */
export const resolveDocumentEditorData = async ({
  content,
  editorData,
  fileType,
}: ResolveDocumentEditorDataParams): Promise<Record<string, any> | undefined> => {
  if (isValidEditorData(editorData)) return editorData;
  if (content === undefined || fileType === CUSTOM_FOLDER_FILE_TYPE) return editorData;

  const snapshot = await createMarkdownEditorSnapshot(content);
  return snapshot.editorData;
};
