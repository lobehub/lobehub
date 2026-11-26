import { z } from 'zod';

import {
  DOCUMENT_CONTENT_MAX_LENGTH,
  DOCUMENT_EDITOR_DATA_MAX_LENGTH,
} from '@/server/routers/lambda/_schema/documentHistory';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

// ==================== Path / Query Schemas ====================

export const DocumentIdParamSchema = z.object({
  id: z.string().min(1),
});
export type DocumentIdParam = z.infer<typeof DocumentIdParamSchema>;

export const DocumentListQuerySchema = z.object({
  ...CursorPaginationQuerySchema.shape,
  parentId: z
    .string()
    .min(1)
    .optional()
    .describe('Only list the direct children of this folder (id or slug).'),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

// ==================== Request Schemas ====================

/**
 * Lexical editor state (`SerializedEditorState`), the shape the web editor
 * saves: a `root` node with at least one child. Nodes are stored as sent, so
 * node types the server does not know survive the round trip.
 */
const EditorDataInputSchema = z
  .looseObject({
    root: z.looseObject({
      children: z.array(z.unknown()).min(1),
      type: z.literal('root'),
    }),
  })
  .describe(
    'Lexical editor state (`SerializedEditorState`) with a non-empty `root`, at most ' +
      `${DOCUMENT_EDITOR_DATA_MAX_LENGTH} characters serialized. Replaces the whole body. ` +
      'When `content` is omitted, the server exports the Markdown body from it. ' +
      'Not accepted for folders or HTML pages (`custom/html`).',
  );

export const CreateDocumentRequestSchema = z
  .object({
    content: z
      .string()
      .max(DOCUMENT_CONTENT_MAX_LENGTH)
      .optional()
      .describe('Markdown body. Omit for a folder.'),
    editorData: EditorDataInputSchema.optional(),
    fileType: z
      .string()
      .min(1)
      .optional()
      .describe('`custom/folder` creates a folder; defaults to a page (`custom/document`).'),
    parentId: z.string().min(1).optional().describe('Folder to create in (id or slug).'),
    title: z.string().min(1),
  })
  .strict();
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const UpdateDocumentRequestSchema = z
  .object({
    content: z
      .string()
      .max(DOCUMENT_CONTENT_MAX_LENGTH)
      .optional()
      .describe(
        'Markdown body; replaces the whole body. Sent with `editorData`, it is stored as that state’s Markdown.',
      ),
    editorData: EditorDataInputSchema.optional(),
    ifUpdatedAt: z.iso
      .datetime({ offset: true })
      .optional()
      .describe(
        'The `updatedAt` the client last read. When the stored `updatedAt` differs, nothing is written and the API answers 409 `conflict`; the error’s `details` entry for `json.ifUpdatedAt` carries the stored `updatedAt` as its message.',
      ),
    title: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.content !== undefined || value.editorData !== undefined || value.title !== undefined,
    { message: 'Provide content, editorData or title' },
  );
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

// ==================== Response Schemas ====================

const documentSummaryShape = {
  createdAt: dateTimeSchema,
  fileType: z.string(),
  id: z.string(),
  parentId: z.string().nullable(),
  slug: z.string().nullable(),
  title: z.string().nullable(),
  updatedAt: dateTimeSchema,
};

export const DocumentSummarySchema = z
  .object(documentSummaryShape)
  .strict()
  .meta({ id: 'DocumentSummary' });
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentSchema = z
  .object({
    ...documentSummaryShape,
    content: z.string().nullable().describe('Markdown body.'),
    editorData: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe(
        'Lexical editor state (`SerializedEditorState`) of the body; `null` for folders, HTML pages and pages saved without one.',
      ),
  })
  .strict()
  .meta({ id: 'Document' });
export type PublicDocument = z.infer<typeof DocumentSchema>;

export const DocumentListResponseSchema = paginatedListSchema(DocumentSummarySchema, {
  total: true,
});
