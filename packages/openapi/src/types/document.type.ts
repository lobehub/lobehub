import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

/**
 * Transport backstops, the same the tRPC document router applies. The plan's
 * per-document character limit is enforced by the service.
 */
export const DOCUMENT_CONTENT_MAX_LENGTH = 10_000_000;
export const DOCUMENT_EDITOR_DATA_MAX_LENGTH = 50_000_000;

/** Batch requests stay small enough to answer within one request. */
export const DOCUMENT_BATCH_MAX = 50;

const commaList = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).optional());

const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

const editorDataSchema = jsonObjectSchema
  .refine((value) => JSON.stringify(value).length <= DOCUMENT_EDITOR_DATA_MAX_LENGTH, {
    message: `editorData must not exceed ${DOCUMENT_EDITOR_DATA_MAX_LENGTH} characters`,
  })
  .describe(
    'Optional editor (Lexical) JSON state. When omitted, the server builds it from the Markdown `content`.',
  );

const markdownContentSchema = z
  .string()
  .max(DOCUMENT_CONTENT_MAX_LENGTH)
  .describe('Document body as Markdown.');

// ==================== Path / Query ====================

export const DocumentIdParamSchema = z.object({ id: z.string().min(1) });
export type DocumentIdParam = z.infer<typeof DocumentIdParamSchema>;

export const DocumentVersionParamSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
});
export type DocumentVersionParam = z.infer<typeof DocumentVersionParamSchema>;

export const DocumentVisibilitySchema = z
  .enum(['private', 'public'])
  .describe(
    'Workspace visibility: `public` pages are shared with workspace members, `private` ones only with their creator. Ignored outside a workspace.',
  );

export const DocumentSourceTypeSchema = z.enum([
  'file',
  'web',
  'api',
  'topic',
  'agent',
  'agent-signal',
]);

export const DocumentSortBySchema = z.enum(['createdAt', 'title', 'updatedAt']);

export const DocumentListQuerySchema = CursorPaginationQuerySchema.extend({
  creator: z
    .enum(['self', 'others'])
    .optional()
    .describe('`self` keeps your own documents, `others` keeps what other members created.'),
  fileTypes: commaList(z.string().min(1)).describe(
    'Comma-separated file types, e.g. `custom/document,custom/folder`.',
  ),
  keyword: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe('Case-insensitive search on the document title.'),
  parentId: z
    .string()
    .min(1)
    .optional()
    .describe('Only direct children of this folder. Pass `root` for top-level documents.'),
  sortBy: DocumentSortBySchema.optional().describe(
    '`updatedAt` (default) and `createdAt` list newest first; `title` lists A→Z.',
  ),
  sourceTypes: commaList(DocumentSourceTypeSchema).describe(
    'Comma-separated source types. Agent-produced documents are hidden unless named here.',
  ),
  standaloneOnly: booleanQuery.describe(
    '`true` keeps only documents outside every knowledge base.',
  ),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

// ==================== Responses ====================

const documentSummaryShape = {
  createdAt: dateTimeSchema,
  fileId: z.string().nullable().describe('Backing file for parsed-file documents.'),
  fileType: z
    .string()
    .describe('`custom/document` for a page, `custom/folder` for a folder, or a file MIME type.'),
  filename: z.string().nullable(),
  id: z.string(),
  metadata: jsonObjectSchema.nullable(),
  parentId: z.string().nullable().describe('Folder this document lives in; `null` at the root.'),
  slug: z.string().nullable(),
  source: z.string(),
  sourceType: DocumentSourceTypeSchema,
  title: z.string().nullable(),
  totalCharCount: z.number().int(),
  totalLineCount: z.number().int(),
  updatedAt: dateTimeSchema,
  userId: z.string().describe('Creator of the document.'),
  visibility: z.enum(['private', 'public']),
  workspaceId: z.string().nullable(),
};

/** A document as listed: everything but the body. */
export const DocumentSummarySchema = z
  .object(documentSummaryShape)
  .strict()
  .meta({ id: 'DocumentSummary' });
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentSchema = z
  .object({
    ...documentSummaryShape,
    content: z.string().nullable().describe('Document body as Markdown.'),
    description: z.string().nullable(),
    editorData: jsonObjectSchema.nullable().describe('Editor (Lexical) JSON state of the body.'),
    knowledgeBaseId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'Document' });
export type DocumentResponse = z.infer<typeof DocumentSchema>;

export const DocumentListResponseSchema = paginatedListSchema(DocumentSummarySchema, {
  total: true,
});

export const DocumentBatchResponseSchema = z
  .object({ items: z.array(DocumentSchema) })
  .strict()
  .meta({ id: 'DocumentBatch' });

export const DocumentBreadcrumbSchema = z
  .object({
    items: z
      .array(z.object({ id: z.string(), name: z.string(), slug: z.string() }).strict())
      .describe('Folders from the root down to (and including) this document.'),
  })
  .strict();

// ==================== Requests ====================

const documentWriteShape = {
  content: markdownContentSchema.optional(),
  editorData: editorDataSchema.optional(),
  fileType: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe('`custom/document` (default) creates a page, `custom/folder` a folder.'),
  knowledgeBaseId: z.string().min(1).optional().describe('Create the document in this library.'),
  metadata: jsonObjectSchema.optional(),
  parentId: z.string().min(1).optional().describe('Folder to create the document in.'),
  slug: z.string().min(1).max(255).optional(),
  title: z.string().max(1000),
  visibility: DocumentVisibilitySchema.optional(),
};

export const CreateDocumentRequestSchema = z.object(documentWriteShape);
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const BatchCreateDocumentsRequestSchema = z.object({
  documents: z.array(z.object(documentWriteShape)).min(1).max(DOCUMENT_BATCH_MAX),
});
export type BatchCreateDocumentsRequest = z.infer<typeof BatchCreateDocumentsRequestSchema>;

export const BatchDeleteDocumentsRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(DOCUMENT_BATCH_MAX),
});
export type BatchDeleteDocumentsRequest = z.infer<typeof BatchDeleteDocumentsRequestSchema>;

export const UpdateDocumentRequestSchema = z
  .object({
    content: markdownContentSchema.optional(),
    editorData: editorDataSchema.optional(),
    expectedUpdatedAt: z
      .string()
      .datetime()
      .optional()
      .describe(
        "Optimistic concurrency: the save fails with 409 unless the document's `updatedAt` still equals this value.",
      ),
    fileType: z.string().min(1).max(255).optional(),
    metadata: jsonObjectSchema.optional(),
    title: z.string().max(1000).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;

export const MoveDocumentRequestSchema = z.object({
  parentId: z
    .string()
    .min(1)
    .nullable()
    .describe('Destination folder id; `null` moves the document to the root.'),
});
export type MoveDocumentRequest = z.infer<typeof MoveDocumentRequestSchema>;

// ==================== Versions ====================

export const DocumentSaveSourceSchema = z.enum([
  'autosave',
  'manual',
  'restore',
  'system',
  'llm_call',
]);

export const DocumentVersionSummarySchema = z
  .object({
    agentId: z.string().nullable().describe('Agent that wrote this version, if any.'),
    editorIds: z.array(z.string()).nullable(),
    id: z.string(),
    isCurrent: z.boolean().describe('Whether this entry is the live document rather than history.'),
    saveSource: DocumentSaveSourceSchema,
    savedAt: dateTimeSchema,
    userId: z.string(),
  })
  .strict()
  .meta({ id: 'DocumentVersionSummary' });

export const DocumentVersionListResponseSchema = paginatedListSchema(DocumentVersionSummarySchema);

export const DocumentVersionSchema = z
  .object({
    content: z.string().describe('The version body rendered as Markdown.'),
    editorData: jsonObjectSchema.nullable().describe('Editor (Lexical) JSON state of the version.'),
    id: z.string(),
    isCurrent: z.boolean(),
    saveSource: DocumentSaveSourceSchema,
    savedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'DocumentVersion' });
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const DocumentVersionCompareQuerySchema = z.object({
  from: z.string().min(1).describe('Older version id.'),
  to: z.string().min(1).describe('Newer version id.'),
});
export type DocumentVersionCompareQuery = z.infer<typeof DocumentVersionCompareQuerySchema>;

export const DocumentVersionCompareSchema = z
  .object({ from: DocumentVersionSchema, to: DocumentVersionSchema })
  .strict();

export const DocumentVersionSavedSchema = z
  .object({
    id: z.string().describe('Id of the stored version.'),
    savedAt: dateTimeSchema.describe('When the snapshot was stored.'),
  })
  .strict();

// ==================== Share ====================

export const DocumentShareSchema = z
  .object({
    documentId: z.string(),
    pageViewCount: z.number().int().min(0),
    permission: z.enum(['read']),
    url: z.string().nullable().describe('Public link while sharing is on; `null` when private.'),
    visibility: z.enum(['private', 'link']).describe('`link`: anyone with the link can read.'),
  })
  .strict()
  .meta({ id: 'DocumentShare' });
export type DocumentShare = z.infer<typeof DocumentShareSchema>;
