import { z } from 'zod';

import { pageInfoShape } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

/** The comment model pages at most 50 rows at a time. */
export const DOCUMENT_COMMENT_PAGE_MAX = 50;

export const DocumentCommentParamSchema = z.object({
  commentId: z.string().min(1).max(255),
  id: z.string().min(1),
});
export type DocumentCommentParam = z.infer<typeof DocumentCommentParamSchema>;

const commentPageQueryShape = {
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("Opaque cursor from the previous page's `nextCursor`. Omit for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DOCUMENT_COMMENT_PAGE_MAX)
    .optional()
    .describe(`Page size, 1–${DOCUMENT_COMMENT_PAGE_MAX}.`),
};

export const DocumentCommentListQuerySchema = z.object({
  ...commentPageQueryShape,
  anchored: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .describe('`true` keeps threads anchored to a text selection, `false` whole-document ones.'),
});
export type DocumentCommentListQuery = z.infer<typeof DocumentCommentListQuerySchema>;

export const DocumentCommentReplyQuerySchema = z.object(commentPageQueryShape);
export type DocumentCommentReplyQuery = z.infer<typeof DocumentCommentReplyQuerySchema>;

const SelectionAnchorSchema = z
  .object({
    end: z.number().int().min(0).describe('Offset just past the quote: `start + quote.length`.'),
    prefix: z.string().max(100).optional(),
    quote: z.string().min(1).max(2000).describe('The selected text the comment is about.'),
    start: z.number().int().min(0),
    suffix: z.string().max(100).optional(),
  })
  .strict()
  .meta({ id: 'DocumentCommentSelectionAnchor' });

const CommentAuthorSchema = z
  .object({
    avatar: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string().nullable(),
    status: z
      .enum(['active', 'deactivated', 'former'])
      .describe('`former`: no longer a workspace member; `deactivated`: the account is gone.'),
    username: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'DocumentCommentAuthor' });

export const DocumentCommentSchema = z
  .object({
    author: CommentAuthorSchema,
    authorUserId: z.string().nullable(),
    canDelete: z.boolean(),
    canEdit: z.boolean(),
    clientId: z.string(),
    content: z.string().describe('Plain-text body.'),
    createdAt: dateTimeSchema,
    deletedAt: dateTimeSchema
      .nullable()
      .describe('Set on a deleted root kept as a tombstone while it still has replies.'),
    documentId: z.string(),
    editorData: jsonObjectSchema
      .nullable()
      .describe('Optional rich-text (Lexical) JSON of the body.'),
    id: z.string(),
    parentCommentId: z.string().nullable().describe('Thread root; `null` for a root comment.'),
    replyTo: z.object({ author: CommentAuthorSchema, id: z.string() }).strict().nullable(),
    replyToCommentId: z.string().nullable(),
    selectionAnchor: SelectionAnchorSchema.nullable(),
    updatedAt: dateTimeSchema,
    workspaceId: z.string(),
  })
  .strict()
  .meta({ id: 'DocumentComment' });

export const DocumentCommentThreadSchema = z
  .object({ replyCount: z.number().int().min(0), root: DocumentCommentSchema })
  .strict()
  .meta({ id: 'DocumentCommentThread' });

export const DocumentCommentThreadListSchema = z
  .object({ items: z.array(DocumentCommentThreadSchema), ...pageInfoShape })
  .strict();

export const DocumentCommentReplyListSchema = z
  .object({ items: z.array(DocumentCommentSchema), ...pageInfoShape })
  .strict();

export const DocumentCommentCreatedSchema = z
  .object({
    comment: DocumentCommentSchema,
    isDuplicate: z
      .boolean()
      .describe('`true` when `clientId` matched an earlier create; that comment is returned.'),
  })
  .strict();

export const DocumentCommentDeletedSchema = z
  .object({
    id: z.string(),
    mode: z
      .enum(['hard', 'soft'])
      .describe('`soft`: a root with replies stays as a tombstone; `hard`: the row is gone.'),
  })
  .strict();

export const CreateDocumentCommentRequestSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Idempotency key for retried creates. Generated when omitted.'),
  content: z.string().trim().max(10_000).describe('Plain-text body.'),
  editorData: jsonObjectSchema.optional().describe('Optional rich-text (Lexical) JSON.'),
  parentCommentId: z.string().trim().min(1).max(255).optional().describe('Reply in this thread.'),
  selectionAnchor: SelectionAnchorSchema.optional().describe(
    'Anchor a root comment to a text selection. Replies inherit their thread anchor.',
  ),
});
export type CreateDocumentCommentRequest = z.infer<typeof CreateDocumentCommentRequestSchema>;

export const UpdateDocumentCommentRequestSchema = z
  .object({
    content: z.string().trim().max(10_000).optional(),
    editorData: jsonObjectSchema.optional(),
  })
  .refine((value) => value.content !== undefined || value.editorData !== undefined, {
    message: 'At least one field must be provided',
  });
export type UpdateDocumentCommentRequest = z.infer<typeof UpdateDocumentCommentRequestSchema>;
