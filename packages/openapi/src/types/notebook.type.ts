import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';
import { DOCUMENT_CONTENT_MAX_LENGTH } from './document.type';

/** Kinds a notebook document can be written as (the `type` the notebook tool accepts). */
export const NotebookDocumentTypeSchema = z
  .enum(['article', 'markdown', 'note', 'report', 'agent/plan'])
  .describe('Kind of notebook document. Defaults to `markdown`.');

export const NotebookIdParamSchema = z.object({ id: z.string().min(1) });
export type NotebookIdParam = z.infer<typeof NotebookIdParamSchema>;

export const NotebookListQuerySchema = CursorPaginationQuerySchema.extend({
  topicId: z.string().min(1).describe('Topic whose notebook to list.'),
  type: NotebookDocumentTypeSchema.optional().describe('Only documents of this kind.'),
});
export type NotebookListQuery = z.infer<typeof NotebookListQuerySchema>;

const notebookDocumentShape = {
  content: z.string().nullable().describe('Document body as Markdown.'),
  createdAt: dateTimeSchema,
  description: z.string().nullable(),
  fileType: z.string().describe('The notebook kind the document was written as.'),
  id: z.string(),
  metadata: jsonObjectSchema.nullable(),
  title: z.string().nullable(),
  totalCharCount: z.number().int(),
  totalLineCount: z.number().int(),
  updatedAt: dateTimeSchema,
};

export const NotebookDocumentSchema = z
  .object(notebookDocumentShape)
  .strict()
  .meta({ id: 'NotebookDocument' });
export type NotebookDocumentResponse = z.infer<typeof NotebookDocumentSchema>;

export const NotebookTopicDocumentSchema = z
  .object({
    ...notebookDocumentShape,
    associatedAt: dateTimeSchema.describe('When the document joined the topic notebook.'),
  })
  .strict()
  .meta({ id: 'NotebookTopicDocument' });

export const NotebookListResponseSchema = paginatedListSchema(NotebookTopicDocumentSchema, {
  total: true,
});

export const CreateNotebookDocumentRequestSchema = z.object({
  content: z.string().max(DOCUMENT_CONTENT_MAX_LENGTH).describe('Document body as Markdown.'),
  description: z.string().max(2000).describe('A one or two sentence summary.'),
  metadata: jsonObjectSchema.optional(),
  title: z.string().min(1).max(1000),
  topicId: z.string().min(1).describe('Topic notebook the document is written into.'),
  type: NotebookDocumentTypeSchema.optional(),
});
export type CreateNotebookDocumentRequest = z.infer<typeof CreateNotebookDocumentRequestSchema>;

export const UpdateNotebookDocumentRequestSchema = z
  .object({
    append: z
      .boolean()
      .optional()
      .describe('Append `content` to the existing body (separated by a blank line).'),
    content: z.string().max(DOCUMENT_CONTENT_MAX_LENGTH).optional(),
    description: z.string().max(2000).optional(),
    metadata: jsonObjectSchema.optional(),
    title: z.string().min(1).max(1000).optional(),
  })
  .refine(
    (value) =>
      value.content !== undefined ||
      value.description !== undefined ||
      value.metadata !== undefined ||
      value.title !== undefined,
    { message: 'At least one field must be provided' },
  );
export type UpdateNotebookDocumentRequest = z.infer<typeof UpdateNotebookDocumentRequestSchema>;

export const AssociateNotebookDocumentRequestSchema = z.object({
  documentId: z.string().min(1).describe('An existing document to add to the notebook.'),
  topicId: z.string().min(1),
});
export type AssociateNotebookDocumentRequest = z.infer<
  typeof AssociateNotebookDocumentRequestSchema
>;

export const NotebookAssociationSchema = z
  .object({ documentId: z.string(), topicId: z.string() })
  .strict()
  .meta({ id: 'NotebookAssociation' });
