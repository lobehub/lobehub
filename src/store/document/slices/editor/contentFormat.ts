import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';

import { isSkillMarkdownDocument } from '@/utils/skillMarkdown';

import type { DocumentContentFormat } from './initialState';

export interface DocumentFormatFields {
  filename?: string | null;
  fileType?: string | null;
  title?: string | null;
}

/** The editor persistence format a server row calls for. */
export const resolveDocumentContentFormat = (
  document: DocumentFormatFields,
): DocumentContentFormat => {
  if (document.fileType === HTML_DOCUMENT_FILE_TYPE) return 'html';
  return isSkillMarkdownDocument(document) ? 'skillMarkdown' : 'markdown';
};

/** Whether a row carries the fields its format is derived from. */
export const hasDocumentFormatFields = (document: DocumentFormatFields): boolean =>
  document.fileType !== undefined ||
  document.filename !== undefined ||
  document.title !== undefined;
