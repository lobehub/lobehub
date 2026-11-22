import { z } from 'zod';

import { DOCUMENT_CONTENT_MAX_LENGTH } from '@/server/routers/lambda/_schema/documentHistory';

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

export const CreateDocumentRequestSchema = z
  .object({
    content: z
      .string()
      .max(DOCUMENT_CONTENT_MAX_LENGTH)
      .optional()
      .describe('Markdown body. Omit for a folder.'),
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
      .describe('Markdown body; replaces the whole body.'),
    title: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.content !== undefined || value.title !== undefined, {
    message: 'Provide content or title',
  });
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
  .object({ ...documentSummaryShape, content: z.string().nullable().describe('Markdown body.') })
  .strict()
  .meta({ id: 'Document' });
export type PublicDocument = z.infer<typeof DocumentSchema>;

export const DocumentListResponseSchema = paginatedListSchema(DocumentSummarySchema, {
  total: true,
});
