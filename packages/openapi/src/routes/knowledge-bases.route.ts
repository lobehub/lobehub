import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { KnowledgeBaseController } from '../controllers/knowledge-base.controller';
import { requireAnyPermission } from '../middleware';
import { requireAuth } from '../middleware/auth';
import {
  CreateKnowledgeBaseSchema,
  KnowledgeBaseFileBatchSchema,
  KnowledgeBaseFileListQuerySchema,
  KnowledgeBaseIdParamSchema,
  KnowledgeBaseListQuerySchema,
  MoveKnowledgeBaseFilesSchema,
  UpdateKnowledgeBaseSchema,
} from '../types/knowledge-base.type';

const app = new Hono();

/**
 * Get knowledge base list
 * GET /knowledge-bases
 *
 * Query parameters:
 * - page: number (optional) - Page number, default 1
 * - pageSize: number (optional) - Items per page, default 20, max 100
 * - keyword: string (optional) - Search keyword (matches name or description)
 */
app.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_READ'), 'You do not have permission to view knowledge base list'),
  zValidator('query', KnowledgeBaseListQuerySchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.getKnowledgeBases(c);
  },
);

/**
 * Create a knowledge base
 * POST /knowledge-bases
 * Content-Type: application/json
 *
 * Request body:
 * {
 *   "name": "Knowledge base name",
 *   "description": "Knowledge base description (optional)",
 *   "avatar": "Avatar URL (optional)"
 * }
 */
app.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_CREATE'), 'You do not have permission to create a knowledge base'),
  zValidator('json', CreateKnowledgeBaseSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.createKnowledgeBase(c);
  },
);

/**
 * Get knowledge base details
 * GET /knowledge-bases/:id
 *
 * Path parameters:
 * - id: string (required) - Knowledge base ID
 */
app.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_READ'), 'You do not have permission to view knowledge base details'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.getKnowledgeBase(c);
  },
);

/**
 * Update a knowledge base
 * PATCH /knowledge-bases/:id
 * Content-Type: application/json
 *
 * Path parameters:
 * - id: string (required) - Knowledge base ID
 *
 * Request body:
 * {
 *   "name": "New name (optional)",
 *   "description": "New description (optional)",
 *   "avatar": "New avatar URL (optional)"
 * }
 */
app.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), 'You do not have permission to update a knowledge base'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', UpdateKnowledgeBaseSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.updateKnowledgeBase(c);
  },
);

/**
 * Delete a knowledge base
 * DELETE /knowledge-bases/:id
 *
 * Path parameters:
 * - id: string (required) - Knowledge base ID
 */
app.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_DELETE'), 'You do not have permission to delete a knowledge base'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.deleteKnowledgeBase(c);
  },
);

/**
 * Get the file list for a specific knowledge base
 * GET /knowledge-bases/:id/files
 *
 * Path parameters:
 * - id: string (required) - Knowledge base ID
 *
 * Query parameters:
 * - page: number (optional) - Page number; when only page is provided, defaults pageSize=20
 * - pageSize: number (optional) - Items per page, max 100; when only pageSize is provided, defaults page=1
 * - fileType: string (optional) - File type filter
 * - keyword: string (optional) - Search keyword (matches file name)
 *
 * Notes:
 * - When neither page nor pageSize is provided, returns all data without pagination
 */
app.get(
  '/:id/files',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('KNOWLEDGE_BASE_READ'),
    'You do not have permission to view knowledge base file list',
  ),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('query', KnowledgeBaseFileListQuerySchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.getKnowledgeBaseFiles(c);
  },
);

/**
 * Batch add file associations to a knowledge base
 * POST /knowledge-bases/:id/files/batch
 */
app.post(
  '/:id/files/batch',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), 'You do not have permission to update knowledge base files'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', KnowledgeBaseFileBatchSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.addFilesToKnowledgeBase(c);
  },
);

/**
 * Batch remove file associations from a knowledge base
 * DELETE /knowledge-bases/:id/files/batch
 */
app.delete(
  '/:id/files/batch',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), 'You do not have permission to update knowledge base files'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', KnowledgeBaseFileBatchSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.removeFilesFromKnowledgeBase(c);
  },
);

/**
 * Batch move files from the current knowledge base to a target knowledge base
 * POST /knowledge-bases/:id/files/move
 */
app.post(
  '/:id/files/move',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), 'You do not have permission to update knowledge base files'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', MoveKnowledgeBaseFilesSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.moveFilesBetweenKnowledgeBases(c);
  },
);

export default app;
