import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { documents } from '../schemas';

interface FileBackedPlaceholderFields {
  content?: string | null;
  fileId?: string | null;
  fileType?: string | null;
  sourceType?: string | null;
}

/**
 * Whether a `documents` row is the empty binding an agent-document upload writes for its file.
 *
 * `AgentDocumentsService.importFile` keeps the uploaded bytes in `files` and inserts an empty
 * `documents` row (`sourceType: 'file'`, the file's own MIME type) so the Documents tree can list and
 * preview the original. That row carries no text: readers wanting the file's text must parse the
 * file instead. Parse results (`parseFile` / `parseDocument`) are stored as `custom/document`, so an
 * empty parse of an empty file is still a real result, not a placeholder.
 */
export const isFileBackedPlaceholder = (doc: FileBackedPlaceholderFields): boolean =>
  doc.sourceType === 'file' &&
  !!doc.fileId &&
  !doc.content &&
  doc.fileType !== CUSTOM_DOCUMENT_FILE_TYPE;

/** SQL twin of {@link isFileBackedPlaceholder}: rows holding the file's text, not its placeholder. */
export const notFileBackedPlaceholder = (): SQL<boolean> =>
  sql<boolean>`NOT (
    ${documents.sourceType} = 'file'
    AND ${documents.fileId} IS NOT NULL
    AND COALESCE(${documents.content}, '') = ''
    AND ${documents.fileType} IS DISTINCT FROM ${CUSTOM_DOCUMENT_FILE_TYPE}
  )`;
