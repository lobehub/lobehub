import { z } from 'zod';

import type { KnowledgeBaseItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Knowledge Base Query Types ====================

/**
 * Knowledge base list query parameters
 */
export interface KnowledgeBaseListQuery extends IPaginationQuery {
  // Inherited from IPaginationQuery: keyword, page, pageSize
}

export const KnowledgeBaseListQuerySchema = PaginationQuerySchema;

/**
 * Knowledge base file list query parameters
 */
export interface KnowledgeBaseFileListQuery extends IPaginationQuery {
  /** File type filter */
  fileType?: string;
}

export const KnowledgeBaseFileListQuerySchema = PaginationQuerySchema.extend({
  fileType: z.string().nullish(),
});

/**
 * Knowledge base file batch operation request
 */
export interface KnowledgeBaseFileBatchRequest {
  /** File ID list */
  fileIds: string[];
}

export const KnowledgeBaseFileBatchSchema = z.object({
  fileIds: z.array(z.string().min(1, '文件ID不能为空')).min(1, '文件ID列表不能为空'),
});

/**
 * Knowledge base file move request
 */
export interface MoveKnowledgeBaseFilesRequest extends KnowledgeBaseFileBatchRequest {
  /** Target knowledge base ID */
  targetKnowledgeBaseId: string;
}

export const MoveKnowledgeBaseFilesSchema = KnowledgeBaseFileBatchSchema.extend({
  targetKnowledgeBaseId: z.string().min(1, '目标知识库 ID 不能为空'),
});

/**
 * Knowledge base file batch operation result
 */
export interface KnowledgeBaseFileOperationResult {
  /** Failed files and reasons */
  failed: Array<{
    fileId: string;
    reason: string;
  }>;
  /** List of successfully operated file IDs */
  successed: string[];
}

/**
 * Knowledge base file move result
 */
export interface MoveKnowledgeBaseFilesResponse {
  /** Failed files and reasons */
  failed: Array<{
    fileId: string;
    reason: string;
  }>;
  /** List of successfully moved file IDs */
  successed: string[];
}

/**
 * Knowledge base list response type
 */
export type KnowledgeBaseAccessType = 'owner' | 'userGrant' | 'roleGrant' | 'public';

export interface KnowledgeBaseListItem extends KnowledgeBaseItem {
  /** The access source type for the current user on this knowledge base */
  accessType?: KnowledgeBaseAccessType;
}

export type KnowledgeBaseListResponse = PaginationQueryResponse<{
  /** Knowledge base list */
  knowledgeBases: KnowledgeBaseListItem[];
}>;

// ==================== Knowledge Base Management Types ====================

/**
 * Knowledge base ID parameter
 */
export const KnowledgeBaseIdParamSchema = z.object({
  id: z.string().min(1, '知识库 ID 不能为空'),
});

/**
 * Create knowledge base request type
 */
export interface CreateKnowledgeBaseRequest {
  /** Knowledge base avatar */
  avatar?: string;
  /** Knowledge base description */
  description?: string;
  /** Knowledge base name */
  name: string;
}

export const CreateKnowledgeBaseSchema = z.object({
  avatar: z.string().url('头像必须是有效的URL').optional(),
  description: z.string().max(1000, '知识库描述过长').optional(),
  name: z.string().min(1, '知识库名称不能为空').max(255, '知识库名称过长'),
});

/**
 * Create knowledge base response type
 */
export interface CreateKnowledgeBaseResponse {
  /** Knowledge base info */
  knowledgeBase: KnowledgeBaseItem;
}

/**
 * Update knowledge base request type
 */
export interface UpdateKnowledgeBaseRequest {
  /** Knowledge base avatar */
  avatar?: string;
  /** Knowledge base description */
  description?: string;
  /** Knowledge base name */
  name?: string;
}

export const UpdateKnowledgeBaseSchema = z.object({
  avatar: z.string().url('头像必须是有效的URL').optional(),
  description: z.string().max(1000, '知识库描述过长').optional(),
  name: z.string().min(1, '知识库名称不能为空').max(255, '知识库名称过长').optional(),
});

/**
 * Knowledge base detail response type
 */
export interface KnowledgeBaseDetailResponse {
  /** Knowledge base info */
  knowledgeBase: KnowledgeBaseItem;
}

/**
 * Delete knowledge base response type
 */
export interface DeleteKnowledgeBaseResponse {
  /** Response message */
  message?: string;
  /** Whether the deletion was successful */
  success: boolean;
}
