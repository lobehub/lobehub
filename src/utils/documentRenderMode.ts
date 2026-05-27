import { getLanguageFromFilename } from './fileLanguage';
import { isSkillMarkdownDocument } from './skillMarkdown';

interface DocumentRenderModeFields {
  filename?: string | null;
  fileType?: string | null;
  title?: string | null;
}

export type DocumentRenderMode = { mode: 'editor' } | { language: string; mode: 'highlight' };

export const getDocumentRenderMode = (document: DocumentRenderModeFields): DocumentRenderMode => {
  if (isSkillMarkdownDocument(document)) return { mode: 'editor' };

  if (!document.filename) return { mode: 'editor' };

  const language = getLanguageFromFilename(document.filename);

  if (language === 'markdown') return { mode: 'editor' };

  return { language, mode: 'highlight' };
};
