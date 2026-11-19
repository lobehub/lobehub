import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { DocumentController } from '../controllers/document.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateDocumentRequestSchema,
  DocumentIdParamSchema,
  DocumentListQuerySchema,
  DocumentListResponseSchema,
  DocumentSchema,
  UpdateDocumentRequestSchema,
} from '../types/document.type';

/**
 * Document routes: create, read, list and replace pages and folders.
 *
 * Reads and writes are gated by the same `document:*` permissions as the
 * in-app document surface, and every write goes through the shared document
 * write flow. History, locks, publishing, visibility and transfers stay
 * in-app only.
 */
const DocumentRoutes = new Hono();

const documentRead = requireAnyPermission(
  getAllScopePermissions('DOCUMENT_READ'),
  'You do not have permission to view documents',
);
const documentCreate = requireAnyPermission(
  getAllScopePermissions('DOCUMENT_CREATE'),
  'You do not have permission to create documents',
);
const documentUpdate = requireAnyPermission(
  getAllScopePermissions('DOCUMENT_UPDATE'),
  'You do not have permission to update documents',
);

/** GET /api/v1/documents */
DocumentRoutes.get(
  '/',
  routeDoc({ data: DocumentListResponseSchema, summary: 'List documents', tags: ['documents'] }),
  requireAuth,
  documentRead,
  zValidator('query', DocumentListQuerySchema),
  async (c) => new DocumentController().listDocuments(c),
);

/** POST /api/v1/documents */
DocumentRoutes.post(
  '/',
  routeDoc({
    data: DocumentSchema,
    description: 'Creates a page from Markdown, or a folder with `fileType: "custom/folder"`.',
    // 404: the parent folder does not exist or is not visible.
    errors: [404],
    status: 201,
    summary: 'Create a document',
    tags: ['documents'],
  }),
  requireAuth,
  documentCreate,
  zValidator('json', CreateDocumentRequestSchema),
  async (c) => new DocumentController().createDocument(c),
);

/** GET /api/v1/documents/:id */
DocumentRoutes.get(
  '/:id',
  routeDoc({ data: DocumentSchema, errors: [404], summary: 'Get a document', tags: ['documents'] }),
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
      'Replaces the title and/or the whole Markdown body. A page open in the editor receives the write through its live room.',
    errors: [404],
    summary: 'Update a document',
    tags: ['documents'],
  }),
  requireAuth,
  documentUpdate,
  zValidator('param', DocumentIdParamSchema),
  zValidator('json', UpdateDocumentRequestSchema),
  async (c) => new DocumentController().updateDocument(c),
);

export default DocumentRoutes;
