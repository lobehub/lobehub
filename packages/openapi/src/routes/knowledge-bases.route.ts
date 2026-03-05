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
 * 获取知识库列表
 * GET /knowledge-bases
 *
 * Query parameters:
 * - page: number (optional) - 页码，默认1
 * - pageSize: number (optional) - 每页数量，默认20，最大100
 * - keyword: string (optional) - 搜索关键词（匹配名称或描述）
 */
app.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_READ'), '您没有权限查看知识库列表'),
  zValidator('query', KnowledgeBaseListQuerySchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.getKnowledgeBases(c);
  },
);

/**
 * 创建知识库
 * POST /knowledge-bases
 * Content-Type: application/json
 *
 * Request body:
 * {
 *   "name": "知识库名称",
 *   "description": "知识库描述（可选）",
 *   "avatar": "头像URL（可选）"
 * }
 */
app.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_CREATE'), '您没有权限创建知识库'),
  zValidator('json', CreateKnowledgeBaseSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.createKnowledgeBase(c);
  },
);

/**
 * 获取知识库详情
 * GET /knowledge-bases/:id
 *
 * Path parameters:
 * - id: string (required) - 知识库ID
 */
app.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_READ'), '您没有权限查看知识库详情'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.getKnowledgeBase(c);
  },
);

/**
 * 更新知识库
 * PATCH /knowledge-bases/:id
 * Content-Type: application/json
 *
 * Path parameters:
 * - id: string (required) - 知识库ID
 *
 * Request body:
 * {
 *   "name": "新名称（可选）",
 *   "description": "新描述（可选）",
 *   "avatar": "新头像URL（可选）"
 * }
 */
app.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), '您没有权限更新知识库'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', UpdateKnowledgeBaseSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.updateKnowledgeBase(c);
  },
);

/**
 * 删除知识库
 * DELETE /knowledge-bases/:id
 *
 * Path parameters:
 * - id: string (required) - 知识库ID
 */
app.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_DELETE'), '您没有权限删除知识库'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.deleteKnowledgeBase(c);
  },
);

/**
 * 获取指定知识库下的文件列表
 * GET /knowledge-bases/:id/files
 *
 * Path parameters:
 * - id: string (required) - 知识库ID
 *
 * Query parameters:
 * - page: number (optional) - 页码；仅传 page 时，默认 pageSize=20
 * - pageSize: number (optional) - 每页数量，默认最大100；仅传 pageSize 时，默认 page=1
 * - fileType: string (optional) - 文件类型过滤
 * - keyword: string (optional) - 搜索关键词（匹配文件名）
 *
 * 说明：
 * - 未提供 page 和 pageSize 时，不进行分页，返回全部数据
 */
app.get(
  '/:id/files',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('KNOWLEDGE_BASE_READ'),
    '您没有权限查看知识库文件列表',
  ),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('query', KnowledgeBaseFileListQuerySchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.getKnowledgeBaseFiles(c);
  },
);

/**
 * 批量为知识库添加文件关联
 * POST /knowledge-bases/:id/files/batch
 */
app.post(
  '/:id/files/batch',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), '您没有权限更新知识库文件'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', KnowledgeBaseFileBatchSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.addFilesToKnowledgeBase(c);
  },
);

/**
 * 批量移除知识库与文件的关联
 * DELETE /knowledge-bases/:id/files/batch
 */
app.delete(
  '/:id/files/batch',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), '您没有权限更新知识库文件'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', KnowledgeBaseFileBatchSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.removeFilesFromKnowledgeBase(c);
  },
);

/**
 * 批量将文件从当前知识库移动到目标知识库
 * POST /knowledge-bases/:id/files/move
 */
app.post(
  '/:id/files/move',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('KNOWLEDGE_BASE_UPDATE'), '您没有权限更新知识库文件'),
  zValidator('param', KnowledgeBaseIdParamSchema),
  zValidator('json', MoveKnowledgeBaseFilesSchema),
  async (c) => {
    const controller = new KnowledgeBaseController();
    return await controller.moveFilesBetweenKnowledgeBases(c);
  },
);

export default app;
