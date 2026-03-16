import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { FileController } from '../controllers/file.controller';
import { requireAnyPermission } from '../middleware';
import { requireAuth } from '../middleware/auth';
import {
  BatchGetFilesRequestSchema,
  FileChunkRequestSchema,
  FileIdParamSchema,
  FileListQuerySchema,
  FileParseRequestSchema,
  FileUrlRequestSchema,
  UpdateFileSchema,
} from '../types/file.type';

const app = new Hono();

/**
 * Get file list
 * GET /files
 *
 * Query parameters:
 * - page: number (optional) - Page number, default 1
 * - pageSize: number (optional) - Items per page, default 20, max 100
 * - fileType: string (optional) - File type filter
 * - keyword: string (optional) - Search keyword
 * - userId: string (optional) - User ID; if provided, returns files for the specified user
 * - knowledgeBaseId: string (optional) - Knowledge base ID, filter files belonging to the specified knowledge base
 * - updatedAtStart: string (optional) - Update time start (ISO 8601 format, e.g. 2024-01-01T00:00:00Z)
 * - updatedAtEnd: string (optional) - Update time end (ISO 8601 format, e.g. 2024-12-31T23:59:59Z)
 */
app.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_READ'), '您没有权限查看文件列表'),
  zValidator('query', FileListQuerySchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.getFiles(c);
  },
);

/**
 * Upload a file and return the corresponding file record
 * The file URL is auto-generated based on the S3 type; accessibility depends on S3 permission settings
 * POST /files
 * Content-Type: multipart/form-data
 *
 * Form fields:
 * - file: File (required) - The file to upload
 * - knowledgeBaseId: string (optional) - Knowledge base ID
 * - agentId: string (optional) - Agent ID; resolved to sessionId first for file association
 * - sessionId: string (optional) - Session ID; if provided, creates a file-session association
 * - skipCheckFileType: boolean (optional) - Whether to skip file type check
 * - directory: string (optional) - Upload directory
 * - skipExist: boolean (optional) - Whether to skip existing parse results, default false
 */
app.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_UPLOAD'), '您没有权限上传文件'),
  async (c) => {
    const fileController = new FileController();
    return await fileController.uploadFile(c);
  },
);

/**
 * Get file details
 * GET /files/:id
 *
 * Path parameters:
 * - id: string (required) - File ID
 */
app.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_READ'), '您没有权限获取文件详情'),
  zValidator('param', FileIdParamSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.getFile(c);
  },
);

/**
 * Get file access URL
 * GET /files/:id/url
 *
 * Path parameters:
 * - id: string (required) - File ID
 *
 * Query parameters:
 * - expiresIn: number (optional) - URL expiration time (seconds), default 3600
 */
app.get(
  '/:id/url',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_READ'), '您没有权限获取文件访问URL'),
  zValidator('param', FileIdParamSchema),
  zValidator('query', FileUrlRequestSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.getFileUrl(c);
  },
);

/**
 * Update a file
 * PATCH /files/:id
 *
 * Path parameters:
 * - id: string (required) - File ID
 *
 * Request body (JSON):
 * {
 *   "knowledgeBaseId": "kb-id" | null (optional) - Knowledge base ID; pass null to remove association
 * }
 */
app.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_UPDATE'), '您没有权限更新文件'),
  zValidator('param', FileIdParamSchema),
  zValidator('json', UpdateFileSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.updateFile(c);
  },
);

/**
 * Delete a file
 * DELETE /files/:id
 *
 * Path parameters:
 * - id: string (required) - File ID
 */
app.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_DELETE'), '您没有权限删除文件'),
  zValidator('param', FileIdParamSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.deleteFile(c);
  },
);

/**
 * Parse file content
 * POST /files/:id/parses
 *
 * Path parameters:
 * - id: string (required) - File ID
 *
 * Query parameters:
 * - skipExist: boolean (optional) - Whether to skip existing parse results, default false
 *
 * Features:
 * - Parses the text content of document files (PDF, Word, Excel, etc.)
 * - Supports skipping already-parsed files to avoid duplicate parsing
 * - Returns the parsed text content and metadata
 */
app.post(
  '/:id/parses',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_UPDATE'), '您没有权限解析文件内容'),
  zValidator('param', FileIdParamSchema),
  zValidator('query', FileParseRequestSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.parseFile(c);
  },
);

/**
 * Trigger file chunking task (optional: auto-trigger embedding)
 * POST /files/:id/chunks
 *
 * Path parameters:
 * - id: string (required) - File ID
 *
 * Request body (JSON):
 * - skipExist?: boolean - Whether to skip existing chunking tasks/results
 * - autoEmbedding?: boolean - Whether to automatically trigger embedding after chunking succeeds
 */
app.post(
  '/:id/chunks',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_UPDATE'), '您没有权限创建分块任务'),
  zValidator('param', FileIdParamSchema),
  zValidator('json', FileChunkRequestSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.createChunkTask(c);
  },
);

/**
 * Query file chunking results and status
 * GET /files/:id/chunks
 *
 * Path parameters:
 * - id: string (required) - File ID
 *
 * Features:
 * - Query file chunking task status (in progress / succeeded / failed)
 * - Returns the current chunk count
 * - Also returns embedding task status and other related information
 */
app.get(
  '/:id/chunks',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_READ'), '您没有权限查看文件分块状态'),
  zValidator('param', FileIdParamSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.getFileChunkStatus(c);
  },
);

/**
 * Batch file upload
 * POST /files/batches
 * Content-Type: multipart/form-data
 *
 * Form fields:
 * - files: File[] (required) - List of files to upload
 * - knowledgeBaseId: string (optional) - Knowledge base ID
 * - agentId: string (optional) - Agent ID; resolved to sessionId first for file association
 * - sessionId: string (optional) - Session ID; if provided, creates a file-session association
 * - skipCheckFileType: boolean (optional) - Whether to skip file type check
 * - directory: string (optional) - Upload directory
 * - skipExist: boolean (optional) - Whether to skip existing parse results, default false
 */
app.post(
  '/batches',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_UPLOAD'), '您没有权限批量上传文件'),
  async (c) => {
    const fileController = new FileController();
    return await fileController.batchUploadFiles(c);
  },
);

/**
 * Batch get file details
 * POST /files/queries
 * Content-Type: application/json
 *
 * Request body:
 * {
 *   "fileIds": ["file1", "file2", "file3"]
 * }
 *
 * Features:
 * - Batch retrieve file details by a list of file IDs
 * - Returns success and failure statistics
 */
app.post(
  '/queries',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('FILE_READ'), '您没有权限批量获取文件详情'),
  zValidator('json', BatchGetFilesRequestSchema),
  async (c) => {
    const fileController = new FileController();
    return await fileController.queries(c);
  },
);

export default app;
