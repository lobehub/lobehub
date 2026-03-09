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
 * 获取文件列表
 * GET /files
 *
 * Query parameters:
 * - page: number (optional) - 页码，默认1
 * - pageSize: number (optional) - 每页数量，默认20，最大100
 * - fileType: string (optional) - 文件类型过滤
 * - keyword: string (optional) - 搜索关键词
 * - userId: string (optional) - 用户ID，如果提供则获取指定用户文件
 * - knowledgeBaseId: string (optional) - 知识库ID，筛选属于指定知识库的文件
 * - updatedAtStart: string (optional) - 更新时间起始（ISO 8601格式，如：2024-01-01T00:00:00Z）
 * - updatedAtEnd: string (optional) - 更新时间结束（ISO 8601格式，如：2024-12-31T23:59:59Z）
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
 * 文件上传并返回相应的文件
 * 文件的 URL 根据 S3 类型自动生成，是否可以访问取决于 S3 的权限设置
 * POST /files
 * Content-Type: multipart/form-data
 *
 * Form fields:
 * - file: File (required) - 要上传的文件
 * - knowledgeBaseId: string (optional) - 知识库ID
 * - agentId: string (optional) - Agent ID，优先解析为 sessionId 并关联文件
 * - sessionId: string (optional) - 会话ID，如果提供则创建文件和会话的关联关系
 * - skipCheckFileType: boolean (optional) - 是否跳过文件类型检查
 * - directory: string (optional) - 上传目录
 * - skipExist: boolean (optional) - 是否跳过已存在的解析结果，默认false
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
 * 获取文件详情
 * GET /files/:id
 *
 * Path parameters:
 * - id: string (required) - 文件ID
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
 * 获取文件访问URL
 * GET /files/:id/url
 *
 * Path parameters:
 * - id: string (required) - 文件ID
 *
 * Query parameters:
 * - expiresIn: number (optional) - URL过期时间（秒），默认3600
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
 * 更新文件
 * PATCH /files/:id
 *
 * Path parameters:
 * - id: string (required) - 文件ID
 *
 * Request body (JSON):
 * {
 *   "knowledgeBaseId": "kb-id" | null (optional) - 知识库ID，传 null 表示取消关联
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
 * 删除文件
 * DELETE /files/:id
 *
 * Path parameters:
 * - id: string (required) - 文件ID
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
 * 解析文件内容
 * POST /files/:id/parses
 *
 * Path parameters:
 * - id: string (required) - 文件ID
 *
 * Query parameters:
 * - skipExist: boolean (optional) - 是否跳过已存在的解析结果，默认false
 *
 * 功能：
 * - 解析文档文件的文本内容（PDF、Word、Excel等）
 * - 支持跳过已解析的文件，避免重复解析
 * - 返回解析后的文本内容和元数据
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
 * 触发文件分块任务（可选：自动触发嵌入）
 * POST /files/:id/chunks
 *
 * Path parameters:
 * - id: string (required) - 文件ID
 *
 * Request body (JSON):
 * - skipExist?: boolean - 是否跳过已存在的分块任务/结果
 * - autoEmbedding?: boolean - 分块成功后是否自动触发嵌入
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
 * 查询文件分块结果和状态
 * GET /files/:id/chunks
 *
 * Path parameters:
 * - id: string (required) - 文件ID
 *
 * 功能：
 * - 查询文件分块任务状态（进行中/成功/失败）
 * - 返回当前分块数量
 * - 同时返回嵌入任务状态等相关信息
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
 * 批量文件上传
 * POST /files/batches
 * Content-Type: multipart/form-data
 *
 * Form fields:
 * - files: File[] (required) - 要上传的文件列表
 * - knowledgeBaseId: string (optional) - 知识库ID
 * - agentId: string (optional) - Agent ID，优先解析为 sessionId 并关联文件
 * - sessionId: string (optional) - 会话ID，如果提供则创建文件和会话的关联关系
 * - skipCheckFileType: boolean (optional) - 是否跳过文件类型检查
 * - directory: string (optional) - 上传目录
 * - skipExist: boolean (optional) - 是否跳过已存在的解析结果，默认false
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
 * 批量获取文件详情
 * POST /files/queries
 * Content-Type: application/json
 *
 * Request body:
 * {
 *   "fileIds": ["file1", "file2", "file3"]
 * }
 *
 * 功能：
 * - 根据文件ID列表批量获取文件详情
 * - 返回成功和失败的统计信息
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
