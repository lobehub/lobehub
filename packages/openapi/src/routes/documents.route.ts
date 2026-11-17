import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { DocumentController } from '../controllers/document.controller';
import { CursorPaginationQuerySchema } from '../helpers/pagination';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import {
  BatchCreateDocumentsRequestSchema,
  BatchDeleteDocumentsRequestSchema,
  CreateDocumentRequestSchema,
  DocumentBatchResponseSchema,
  DocumentBreadcrumbSchema,
  DocumentIdParamSchema,
  DocumentListQuerySchema,
  DocumentListResponseSchema,
  DocumentSchema,
  DocumentShareSchema,
  DocumentVersionCompareQuerySchema,
  DocumentVersionCompareSchema,
  DocumentVersionListResponseSchema,
  DocumentVersionParamSchema,
  DocumentVersionSavedSchema,
  DocumentVersionSchema,
  MoveDocumentRequestSchema,
  UpdateDocumentRequestSchema,
} from '../types/document.type';
import {
  CreateDocumentCommentRequestSchema,
  DocumentCommentCreatedSchema,
  DocumentCommentDeletedSchema,
  DocumentCommentListQuerySchema,
  DocumentCommentParamSchema,
  DocumentCommentReplyListSchema,
  DocumentCommentReplyQuerySchema,
  DocumentCommentSchema,
  DocumentCommentThreadListSchema,
  UpdateDocumentCommentRequestSchema,
} from '../types/document-comment.type';

/**
 * Document (Page) routes: documents and folders, their version history, the
 * public share link and the comment threads on them.
 *
 * Every gate checks the caller's workspace RBAC for the document action and
 * narrows API keys to the `document:read` / `document:write` scopes. Which rows
 * a caller sees (private pages, restricted libraries, other workspaces) is
 * decided by the shared document service, and anything not visible is a 404.
 */
const DocumentRoutes = new Hono();

const TAGS = ['documents'];

const documentGate = (
  action: 'DOCUMENT_CREATE' | 'DOCUMENT_DELETE' | 'DOCUMENT_READ' | 'DOCUMENT_UPDATE',
  message: string,
) =>
  requireAnyPermissionWithApiKeyScope(
    getAllScopePermissions(action),
    action === 'DOCUMENT_READ' ? 'document:read' : 'document:write',
    message,
  );

const documentRead = documentGate('DOCUMENT_READ', 'You do not have permission to view documents');
const documentCreate = documentGate(
  'DOCUMENT_CREATE',
  'You do not have permission to create documents',
);
const documentUpdate = documentGate(
  'DOCUMENT_UPDATE',
  'You do not have permission to update documents',
);
const documentDelete = documentGate(
  'DOCUMENT_DELETE',
  'You do not have permission to delete documents',
);

const commentGate = (
  action:
    | 'DOCUMENT_COMMENT_CREATE'
    | 'DOCUMENT_COMMENT_DELETE'
    | 'DOCUMENT_COMMENT_READ'
    | 'DOCUMENT_COMMENT_UPDATE',
) =>
  requireAnyPermissionWithApiKeyScope(
    getAllScopePermissions(action),
    action === 'DOCUMENT_COMMENT_READ' ? 'document:read' : 'document:write',
    'Insufficient document comment permission',
  );

const DOCUMENT_EXAMPLE = {
  content: '## Goals\n\n- Ship the public documents API',
  createdAt: '2026-01-15T08:30:00.000Z',
  description: null,
  editorData: null,
  fileId: null,
  fileType: 'custom/document',
  filename: 'Q3 plan',
  id: 'docs_8Fq2LmZ0vX1p',
  knowledgeBaseId: null,
  metadata: { emoji: '🗺️' },
  parentId: null,
  slug: 'q3-plan',
  source: 'document',
  sourceType: 'api' as const,
  title: 'Q3 plan',
  totalCharCount: 41,
  totalLineCount: 3,
  updatedAt: '2026-01-15T09:12:00.000Z',
  userId: 'user_2a9X',
  visibility: 'public' as const,
  workspaceId: null,
};

// ==================== Documents ====================

/** GET /api/v1/documents — list and search documents and folders. */
DocumentRoutes.get(
  '/',
  routeDoc({
    data: DocumentListResponseSchema,
    description:
      'Lists the documents and folders the caller can see, newest first. Filter by folder with `parentId`, search titles with `keyword`. Items omit the body; fetch a document for its Markdown.',
    operationId: 'documents.list',
    summary: 'List and search documents',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('query', DocumentListQuerySchema),
  async (c) => new DocumentController().listDocuments(c),
);

/** POST /api/v1/documents — create a document or folder from Markdown. */
DocumentRoutes.post(
  '/',
  routeDoc({
    data: DocumentSchema,
    description:
      'Creates a page (or a folder with `fileType: custom/folder`). Send the body as Markdown in `content`; the editor state is built from it unless `editorData` is given.',
    // A `parentId` or `knowledgeBaseId` the caller cannot see.
    errors: [404],
    operationId: 'documents.create',
    requestExample: example(CreateDocumentRequestSchema, {
      content: '## Goals\n\n- Ship the public documents API',
      metadata: { emoji: '🗺️' },
      title: 'Q3 plan',
    }),
    responseExample: DOCUMENT_EXAMPLE,
    status: 201,
    summary: 'Create a document',
    tags: TAGS,
  }),
  requireAuth,
  documentCreate,
  zValidator('json', CreateDocumentRequestSchema),
  async (c) => new DocumentController().createDocument(c),
);

/** POST /api/v1/documents/batch — create several documents at once. */
DocumentRoutes.post(
  '/batch',
  routeDoc({
    data: DocumentBatchResponseSchema,
    description: 'Creates up to 50 documents in one request, in the order given.',
    errors: [404],
    operationId: 'documents.batchCreate',
    status: 201,
    summary: 'Create documents in bulk',
    tags: TAGS,
  }),
  requireAuth,
  documentCreate,
  zValidator('json', BatchCreateDocumentsRequestSchema),
  async (c) => new DocumentController().batchCreateDocuments(c),
);

/** POST /api/v1/documents/batch-delete — delete several documents at once. */
DocumentRoutes.post(
  '/batch-delete',
  routeDoc({
    data: DeletedResourcesSchema,
    description:
      'Deletes up to 50 documents (folders take their contents with them). Fails with 404 without deleting anything when any id is not visible to the caller.',
    errors: [404],
    operationId: 'documents.batchDelete',
    summary: 'Delete documents in bulk',
    tags: TAGS,
  }),
  requireAuth,
  documentDelete,
  zValidator('json', BatchDeleteDocumentsRequestSchema),
  async (c) => new DocumentController().batchDeleteDocuments(c),
);

/** GET /api/v1/documents/:id */
DocumentRoutes.get(
  '/:id',
  routeDoc({
    data: DocumentSchema,
    description: 'Returns the document with its body as Markdown (`content`) and editor JSON.',
    errors: [404],
    operationId: 'documents.get',
    responseExample: DOCUMENT_EXAMPLE,
    summary: 'Get a document',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().getDocument(c),
);

/** PATCH /api/v1/documents/:id */
DocumentRoutes.patch(
  '/:id',
  routeDoc({
    data: DocumentSchema,
    description:
      'Updates the title, metadata or body. A Markdown `content` replaces the body; pass `expectedUpdatedAt` to fail with 409 instead of overwriting a newer save.',
    // 409: `expectedUpdatedAt` is stale, or another member holds the page's edit lock.
    errors: [404, 409],
    operationId: 'documents.update',
    summary: 'Update a document',
    tags: TAGS,
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentIdParamSchema),
  zValidator('json', UpdateDocumentRequestSchema),
  async (c) => new DocumentController().updateDocument(c),
);

/** DELETE /api/v1/documents/:id */
DocumentRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Deletes the document; deleting a folder deletes what it contains.',
    errors: [404],
    operationId: 'documents.delete',
    summary: 'Delete a document',
    tags: TAGS,
  }),
  requireAuth,
  documentDelete,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().deleteDocument(c),
);

/** POST /api/v1/documents/:id/move — move into a folder or to the root. */
DocumentRoutes.post(
  '/:id/move',
  routeDoc({
    data: DocumentSchema,
    description:
      'Moves the document into the folder `parentId`, or to the root with `null`. A folder cannot move into its own subtree.',
    errors: [404],
    operationId: 'documents.move',
    summary: 'Move a document to a folder',
    tags: TAGS,
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentIdParamSchema),
  zValidator('json', MoveDocumentRequestSchema),
  async (c) => new DocumentController().moveDocument(c),
);

/** GET /api/v1/documents/:id/breadcrumb — the folder chain down to a document. */
DocumentRoutes.get(
  '/:id/breadcrumb',
  routeDoc({
    data: DocumentBreadcrumbSchema,
    description: 'The folders from the root down to this document, for navigation.',
    errors: [404],
    operationId: 'documents.getBreadcrumb',
    summary: 'Get the folder breadcrumb of a document',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().getBreadcrumb(c),
);

// ==================== Versions ====================

/** GET /api/v1/documents/:id/versions */
DocumentRoutes.get(
  '/:id/versions',
  routeDoc({
    data: DocumentVersionListResponseSchema,
    description:
      'Saved versions of the document, newest first. The first page starts with the live document (`isCurrent: true`).',
    errors: [404],
    operationId: 'documents.listVersions',
    summary: 'List document versions',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('param', DocumentIdParamSchema),
  zValidator('query', CursorPaginationQuerySchema),
  async (c) => new DocumentController().listVersions(c),
);

/** POST /api/v1/documents/:id/versions — snapshot the current body as a version. */
DocumentRoutes.post(
  '/:id/versions',
  routeDoc({
    data: DocumentVersionSavedSchema,
    description: 'Stores the document as it is now as a manual version.',
    errors: [404, 409],
    operationId: 'documents.saveVersion',
    status: 201,
    summary: 'Save a document version',
    tags: TAGS,
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().saveVersion(c),
);

/** GET /api/v1/documents/:id/versions/compare?from=&to= */
DocumentRoutes.get(
  '/:id/versions/compare',
  routeDoc({
    data: DocumentVersionCompareSchema,
    description: 'Both versions side by side, each as Markdown and editor JSON.',
    errors: [404],
    operationId: 'documents.compareVersions',
    summary: 'Compare two document versions',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('param', DocumentIdParamSchema),
  zValidator('query', DocumentVersionCompareQuerySchema),
  async (c) => new DocumentController().compareVersions(c),
);

/** GET /api/v1/documents/:id/versions/:versionId */
DocumentRoutes.get(
  '/:id/versions/:versionId',
  routeDoc({
    data: DocumentVersionSchema,
    description: 'One version of the document, as Markdown and editor JSON.',
    errors: [404],
    operationId: 'documents.getVersion',
    summary: 'Get a document version',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('param', DocumentVersionParamSchema),
  async (c) => new DocumentController().getVersion(c),
);

/** POST /api/v1/documents/:id/versions/:versionId/restore */
DocumentRoutes.post(
  '/:id/versions/:versionId/restore',
  routeDoc({
    data: DocumentSchema,
    description:
      'Writes the version back as the current body. The replaced body stays in the history.',
    errors: [404, 409],
    operationId: 'documents.restoreVersion',
    summary: 'Restore a document version',
    tags: TAGS,
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentVersionParamSchema),
  async (c) => new DocumentController().restoreVersion(c),
);

// ==================== Share ====================

/** GET /api/v1/documents/:id/share */
DocumentRoutes.get(
  '/:id/share',
  routeDoc({
    data: DocumentShareSchema,
    description: 'Whether the public share link is on, and its URL and view count.',
    errors: [404],
    operationId: 'documents.getShare',
    summary: 'Get the share link of a document',
    tags: TAGS,
  }),
  requireAuth,
  documentRead,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().getShare(c),
);

/** POST /api/v1/documents/:id/share — turn the public read-only link on. */
DocumentRoutes.post(
  '/:id/share',
  routeDoc({
    data: DocumentShareSchema,
    description:
      'Turns on a read-only link anyone can open. Only the page creator or a workspace owner may do this. 412 on deployments without page sharing.',
    errors: [404, 412],
    operationId: 'documents.enableShare',
    summary: 'Enable the share link of a document',
    tags: TAGS,
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().enableShare(c),
);

/** DELETE /api/v1/documents/:id/share — turn the public link off. */
DocumentRoutes.delete(
  '/:id/share',
  routeDoc({
    data: DocumentShareSchema,
    description: 'Turns the public link off; the page is private again.',
    errors: [404, 412],
    operationId: 'documents.disableShare',
    summary: 'Disable the share link of a document',
    tags: TAGS,
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentIdParamSchema),
  async (c) => new DocumentController().disableShare(c),
);

// ==================== Comments ====================

/** GET /api/v1/documents/:id/comments — comment threads, newest first. */
DocumentRoutes.get(
  '/:id/comments',
  routeDoc({
    data: DocumentCommentThreadListSchema,
    description:
      'Root comments with their reply counts. Comments exist inside a workspace only: without `X-Workspace-Id` the call answers 412.',
    errors: [404, 412],
    operationId: 'documents.listComments',
    summary: 'List comment threads on a document',
    tags: TAGS,
  }),
  requireAuth,
  commentGate('DOCUMENT_COMMENT_READ'),
  zValidator('param', DocumentIdParamSchema),
  zValidator('query', DocumentCommentListQuerySchema),
  async (c) => new DocumentController().listComments(c),
);

/** POST /api/v1/documents/:id/comments — start a thread or reply in one. */
DocumentRoutes.post(
  '/:id/comments',
  routeDoc({
    data: DocumentCommentCreatedSchema,
    description:
      'Adds a root comment (optionally anchored to a text selection) or, with `parentCommentId`, a reply. Retries with the same `clientId` return the first comment.',
    errors: [404, 412],
    operationId: 'documents.createComment',
    status: 201,
    summary: 'Comment on a document',
    tags: TAGS,
  }),
  requireAuth,
  commentGate('DOCUMENT_COMMENT_CREATE'),
  zValidator('param', DocumentIdParamSchema),
  zValidator('json', CreateDocumentCommentRequestSchema),
  async (c) => new DocumentController().createComment(c),
);

/** GET /api/v1/documents/:id/comments/:commentId/replies */
DocumentRoutes.get(
  '/:id/comments/:commentId/replies',
  routeDoc({
    data: DocumentCommentReplyListSchema,
    description: 'Replies in one thread, oldest first.',
    errors: [404, 412],
    operationId: 'documents.listCommentReplies',
    summary: 'List replies in a comment thread',
    tags: TAGS,
  }),
  requireAuth,
  commentGate('DOCUMENT_COMMENT_READ'),
  zValidator('param', DocumentCommentParamSchema),
  zValidator('query', DocumentCommentReplyQuerySchema),
  async (c) => new DocumentController().listCommentReplies(c),
);

/** PATCH /api/v1/documents/:id/comments/:commentId — authors edit their own comments. */
DocumentRoutes.patch(
  '/:id/comments/:commentId',
  routeDoc({
    data: DocumentCommentSchema,
    description: 'Edits a comment. Only its author can edit it.',
    errors: [404, 412],
    operationId: 'documents.updateComment',
    summary: 'Edit a document comment',
    tags: TAGS,
  }),
  requireAuth,
  commentGate('DOCUMENT_COMMENT_UPDATE'),
  zValidator('param', DocumentCommentParamSchema),
  zValidator('json', UpdateDocumentCommentRequestSchema),
  async (c) => new DocumentController().updateComment(c),
);

/** DELETE /api/v1/documents/:id/comments/:commentId */
DocumentRoutes.delete(
  '/:id/comments/:commentId',
  routeDoc({
    data: DocumentCommentDeletedSchema,
    description:
      'Deletes a comment. A root that still has replies stays as a tombstone (`mode: soft`).',
    errors: [404, 412],
    operationId: 'documents.deleteComment',
    summary: 'Delete a document comment',
    tags: TAGS,
  }),
  requireAuth,
  commentGate('DOCUMENT_COMMENT_DELETE'),
  zValidator('param', DocumentCommentParamSchema),
  async (c) => new DocumentController().deleteComment(c),
);

export default DocumentRoutes;
