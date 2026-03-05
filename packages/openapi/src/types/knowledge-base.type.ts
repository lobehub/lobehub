import { z } from 'zod';

import type { KnowledgeBaseItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Knowledge Base Query Types ====================

/**
 * 知识库列表查询参数
 */
export interface KnowledgeBaseListQuery extends IPaginationQuery {
  // 继承自 IPaginationQuery: keyword, page, pageSize
}

export const KnowledgeBaseListQuerySchema = PaginationQuerySchema;

/**
 * 知识库文件列表查询参数
 */
export interface KnowledgeBaseFileListQuery extends IPaginationQuery {
  /** 文件类型过滤 */
  fileType?: string;
}

export const KnowledgeBaseFileListQuerySchema = PaginationQuerySchema.extend({
  fileType: z.string().nullish(),
});

/**
 * 知识库文件批量操作请求
 */
export interface KnowledgeBaseFileBatchRequest {
  /** 文件 ID 列表 */
  fileIds: string[];
}

export const KnowledgeBaseFileBatchSchema = z.object({
  fileIds: z.array(z.string().min(1, '文件ID不能为空')).min(1, '文件ID列表不能为空'),
});

/**
 * 知识库文件移动请求
 */
export interface MoveKnowledgeBaseFilesRequest extends KnowledgeBaseFileBatchRequest {
  /** 目标知识库 ID */
  targetKnowledgeBaseId: string;
}

export const MoveKnowledgeBaseFilesSchema = KnowledgeBaseFileBatchSchema.extend({
  targetKnowledgeBaseId: z.string().min(1, '目标知识库 ID 不能为空'),
});

/**
 * 知识库文件批量操作结果
 */
export interface KnowledgeBaseFileOperationResult {
  /** 失败的文件及原因 */
  failed: Array<{
    fileId: string;
    reason: string;
  }>;
  /** 操作成功的文件 ID 列表 */
  successed: string[];
}

/**
 * 知识库文件移动结果
 */
export interface MoveKnowledgeBaseFilesResponse {
  /** 失败的文件及原因 */
  failed: Array<{
    fileId: string;
    reason: string;
  }>;
  /** 成功移动的文件 ID 列表 */
  successed: string[];
}

/**
 * 知识库列表响应类型
 */
export type KnowledgeBaseAccessType = 'owner' | 'userGrant' | 'roleGrant' | 'public';

export interface KnowledgeBaseListItem extends KnowledgeBaseItem {
  /** 当前用户对该知识库的访问来源类型 */
  accessType?: KnowledgeBaseAccessType;
}

export type KnowledgeBaseListResponse = PaginationQueryResponse<{
  /** 知识库列表 */
  knowledgeBases: KnowledgeBaseListItem[];
}>;

// ==================== Knowledge Base Management Types ====================

/**
 * 知识库ID参数
 */
export const KnowledgeBaseIdParamSchema = z.object({
  id: z.string().min(1, '知识库 ID 不能为空'),
});

/**
 * 创建知识库请求类型
 */
export interface CreateKnowledgeBaseRequest {
  /** 知识库头像 */
  avatar?: string;
  /** 知识库描述 */
  description?: string;
  /** 知识库名称 */
  name: string;
}

export const CreateKnowledgeBaseSchema = z.object({
  avatar: z.string().url('头像必须是有效的URL').optional(),
  description: z.string().max(1000, '知识库描述过长').optional(),
  name: z.string().min(1, '知识库名称不能为空').max(255, '知识库名称过长'),
});

/**
 * 创建知识库响应类型
 */
export interface CreateKnowledgeBaseResponse {
  /** 知识库信息 */
  knowledgeBase: KnowledgeBaseItem;
}

/**
 * 更新知识库请求类型
 */
export interface UpdateKnowledgeBaseRequest {
  /** 知识库头像 */
  avatar?: string;
  /** 知识库描述 */
  description?: string;
  /** 知识库名称 */
  name?: string;
}

export const UpdateKnowledgeBaseSchema = z.object({
  avatar: z.string().url('头像必须是有效的URL').optional(),
  description: z.string().max(1000, '知识库描述过长').optional(),
  name: z.string().min(1, '知识库名称不能为空').max(255, '知识库名称过长').optional(),
});

/**
 * 知识库详情响应类型
 */
export interface KnowledgeBaseDetailResponse {
  /** 知识库信息 */
  knowledgeBase: KnowledgeBaseItem;
}

/**
 * 删除知识库响应类型
 */
export interface DeleteKnowledgeBaseResponse {
  /** 响应消息 */
  message?: string;
  /** 是否删除成功 */
  success: boolean;
}
