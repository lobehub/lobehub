import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { NotebookController } from '../controllers/notebook.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  AssociateNotebookDocumentRequestSchema,
  CreateNotebookDocumentRequestSchema,
  NotebookAssociationSchema,
  NotebookDocumentSchema,
  NotebookIdParamSchema,
  NotebookListQuerySchema,
  NotebookListResponseSchema,
  UpdateNotebookDocumentRequestSchema,
} from '../types/notebook.type';

/**
 * Topic notebook routes.
 *
 * A notebook is the set of documents attached to one topic — reports, notes and
 * plans an agent writes during a conversation. These routes read and write that
 * set; the documents themselves are ordinary documents, also reachable through
 * `/documents`. Gated by the same document RBAC and `document:*` API-key scopes.
 */
const NotebookRoutes = new Hono();

const TAGS = ['notebooks'];

const notebookRead = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('DOCUMENT_READ'),
  'document:read',
  'You do not have permission to view notebooks',
);
const notebookCreate = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('DOCUMENT_CREATE'),
  'document:write',
  'You do not have permission to write notebooks',
);
const notebookUpdate = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('DOCUMENT_UPDATE'),
  'document:write',
  'You do not have permission to write notebooks',
);
const notebookDelete = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('DOCUMENT_DELETE'),
  'document:write',
  'You do not have permission to delete notebook documents',
);

/** GET /api/v1/notebooks?topicId= — the documents in a topic's notebook. */
NotebookRoutes.get(
  '/',
  routeDoc({
    data: NotebookListResponseSchema,
    description: "Lists the documents in a topic's notebook, newest first, with their Markdown.",
    errors: [404],
    operationId: 'notebooks.list',
    summary: 'List notebook documents',
    tags: TAGS,
  }),
  requireAuth,
  notebookRead,
  zValidator('query', NotebookListQuerySchema),
  async (c) => new NotebookController().listDocuments(c),
);

/** POST /api/v1/notebooks — write a Markdown document into a topic's notebook. */
NotebookRoutes.post(
  '/',
  routeDoc({
    data: NotebookDocumentSchema,
    description:
      'Writes a Markdown document into the topic notebook. Writing the same title, kind and content again returns the existing document instead of a copy.',
    errors: [404],
    operationId: 'notebooks.create',
    status: 201,
    summary: 'Create a notebook document',
    tags: TAGS,
  }),
  requireAuth,
  notebookCreate,
  zValidator('json', CreateNotebookDocumentRequestSchema),
  async (c) => new NotebookController().createDocument(c),
);

/** POST /api/v1/notebooks/associate — attach an existing document to a topic. */
NotebookRoutes.post(
  '/associate',
  routeDoc({
    data: NotebookAssociationSchema,
    description:
      "Adds an existing document to a topic's notebook without copying it. Repeating the call is a no-op.",
    errors: [404],
    operationId: 'notebooks.associateDocument',
    summary: 'Add a document to a notebook',
    tags: TAGS,
  }),
  requireAuth,
  notebookUpdate,
  zValidator('json', AssociateNotebookDocumentRequestSchema),
  async (c) => new NotebookController().associateDocument(c),
);

/** GET /api/v1/notebooks/:id */
NotebookRoutes.get(
  '/:id',
  routeDoc({
    data: NotebookDocumentSchema,
    errors: [404],
    operationId: 'notebooks.get',
    summary: 'Get a notebook document',
    tags: TAGS,
  }),
  requireAuth,
  notebookRead,
  zValidator('param', NotebookIdParamSchema),
  async (c) => new NotebookController().getDocument(c),
);

/** PATCH /api/v1/notebooks/:id — edit or append to a notebook document. */
NotebookRoutes.patch(
  '/:id',
  routeDoc({
    data: NotebookDocumentSchema,
    description: 'Updates the title, summary or body. With `append: true` the body is extended.',
    errors: [404],
    operationId: 'notebooks.update',
    summary: 'Update a notebook document',
    tags: TAGS,
  }),
  requireAuth,
  notebookUpdate,
  zValidator('param', NotebookIdParamSchema),
  zValidator('json', UpdateNotebookDocumentRequestSchema),
  async (c) => new NotebookController().updateDocument(c),
);

/** DELETE /api/v1/notebooks/:id */
NotebookRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    operationId: 'notebooks.delete',
    summary: 'Delete a notebook document',
    tags: TAGS,
  }),
  requireAuth,
  notebookDelete,
  zValidator('param', NotebookIdParamSchema),
  async (c) => new NotebookController().deleteDocument(c),
);

export default NotebookRoutes;
