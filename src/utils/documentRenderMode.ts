import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_FILE_TYPE,
  AGENT_PLAN_FILE_TYPE,
  CUSTOM_DOCUMENT_FILE_TYPE,
  EDITOR_DOCUMENT_SOURCE_TYPES,
  hasFilenameExtension,
  MARKDOWN_DOCUMENT_FILE_TYPES,
} from '@lobechat/const';

import { getLanguageFromFilename } from './fileLanguage';
import { isSkillMarkdownDocument } from './skillMarkdown';

interface DocumentRenderModeFields {
  category?: string | null;
  filename?: string | null;
  fileType?: string | null;
  sourceType?: string | null;
  title?: string | null;
}

export type DocumentRenderMode = { mode: 'editor' } | { language: string; mode: 'highlight' };

const EDITOR_DOCUMENT_FILE_TYPES = new Set([
  AGENT_DOCUMENT_FILE_TYPE,
  AGENT_PLAN_FILE_TYPE,
  CUSTOM_DOCUMENT_FILE_TYPE,
  ...MARKDOWN_DOCUMENT_FILE_TYPES,
]);

const isEditorDocument = (document: DocumentRenderModeFields): boolean => {
  if (document.category === AGENT_DOCUMENT_CATEGORY) return true;
  if (document.fileType && EDITOR_DOCUMENT_FILE_TYPES.has(document.fileType)) return true;
  return !!document.sourceType && EDITOR_DOCUMENT_SOURCE_TYPES.includes(document.sourceType);
};

export const getDocumentRenderMode = (document: DocumentRenderModeFields): DocumentRenderMode => {
  if (isSkillMarkdownDocument(document)) return { mode: 'editor' };

  if (!document.filename) return { mode: 'editor' };

  const language = getLanguageFromFilename(document.filename);

  if (language === 'markdown') return { mode: 'editor' };
  if (isEditorDocument(document) && !hasFilenameExtension(document.filename))
    return { mode: 'editor' };

  return { language, mode: 'highlight' };
};
