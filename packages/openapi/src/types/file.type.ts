import { z } from 'zod';

import type { FileItem, KnowledgeBaseItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== File Upload Types ====================

/**
 * 文件上传请求类型
 */
export interface FileUploadRequest {
  /** Agent ID（可选，优先于 sessionId） */
  agentId?: string;
  /** 文件目录（可选） */
  directory?: string;
  /** 文件对象 */
  file: File;
  /** 知识库ID（可选） */
  knowledgeBaseId?: string;
  /** 自定义路径（可选） */
  pathname?: string;
  /** 会话ID（可选） */
  sessionId?: string;
  /** 是否跳过文件类型检查 */
  skipCheckFileType?: boolean;
  /** 是否跳过去重检查 */
  skipDeduplication?: boolean;
}

/**
 * 文件详情类型
 */
export interface FileDetailResponse {
  file: FileListItem;
  parsed?: FileParseResponse;
}

/**
 * 公共文件上传请求类型
 */
export interface PublicFileUploadRequest {
  /** Agent ID（可选，优先于 sessionId） */
  agentId?: string;
  /** 文件目录（可选） */
  directory?: string;
  /** 知识库ID（可选） */
  knowledgeBaseId?: string;
  /** 会话ID（可选） */
  sessionId?: string;
  /** 是否跳过文件类型检查 */
  skipCheckFileType?: boolean;
  /** 是否跳过去重检查 */
  skipDeduplication?: boolean;
}

// ==================== File Management Types ====================

/**
 * 文件列表查询参数
 */
export interface FileListQuery extends IPaginationQuery {
  /** 文件类型过滤 */
  fileType?: string;
  /** 知识库ID过滤 */
  knowledgeBaseId?: string;
  /** 是否查询全量数据（需要 ALL 权限） */
  queryAll?: boolean;
  /** 更新时间结束 */
  updatedAtEnd?: string;
  /** 更新时间起始 */
  updatedAtStart?: string;
  /** 用户ID */
  userId?: string;
}

export const FileListQuerySchema = PaginationQuerySchema.extend({
  fileType: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  queryAll: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .optional(),
  updatedAtEnd: z.string().datetime().optional(),
  updatedAtStart: z.string().datetime().optional(),
  userId: z.string().optional(),
});

/**
 * 文件列表响应类型
 */
export type FileListResponse = PaginationQueryResponse<{
  /** 文件列表 */
  files: FileDetailResponse['file'][];
  /** 文件总大小 */
  totalSize?: string;
}>;

// ==================== File URL Types ====================

/**
 * 获取文件URL请求类型
 */
export interface FileUrlRequest {
  /** 过期时间（秒），默认为系统配置值 */
  expiresIn?: number;
}

export const FileUrlRequestSchema = z.object({
  expiresIn: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number())
    .nullish(),
});

/**
 * 获取文件URL响应类型
 */
export interface FileUrlResponse {
  /** URL过期时间戳 */
  expiresAt: string;
  /** URL过期时间（秒） */
  expiresIn: number;
  /** 文件ID */
  fileId: string;
  /** 文件名 */
  name: string;
  /** 预签名访问URL */
  url: string;
}

// ==================== Batch Operations ====================

/**
 * 批量文件上传请求类型
 */
export interface BatchFileUploadRequest {
  /** Agent ID（可选，优先于 sessionId） */
  agentId?: string;
  /** 上传目录（可选） */
  directory?: string;
  /** 文件列表 */
  files: File[];
  /** 知识库ID（可选） */
  knowledgeBaseId?: string;
  /** 会话ID（可选） */
  sessionId?: string;
  /** 是否跳过文件类型检查 */
  skipCheckFileType?: boolean;
}

/**
 * 批量文件上传响应类型
 */
export interface BatchFileUploadResponse {
  /** 失败的文件及错误信息 */
  failed: Array<{
    error: string;
    name: string;
  }>;
  /** 成功上传的文件 */
  successful: FileDetailResponse[];
  /** 总计数量 */
  summary: {
    failed: number;
    successful: number;
    total: number;
  };
}

/**
 * 批量获取文件请求类型
 */
export interface BatchGetFilesRequest {
  /** 文件ID列表 */
  fileIds: string[];
}

export const BatchGetFilesRequestSchema = z.object({
  fileIds: z.array(z.string().min(1, '文件ID不能为空')).min(1, '文件ID列表不能为空'),
});

/**
 * 批量获取文件响应类型
 */
export interface BatchGetFilesResponse {
  /** 失败的文件及错误信息 */
  failed: Array<{
    error: string;
    fileId: string;
  }>;
  /** 文件列表 */
  files: Array<FileDetailResponse>;
  /** 成功获取的文件数 */
  success: number;
  /** 请求总数 */
  total: number;
}

// ==================== File Parsing Types ====================

/**
 * 文件解析请求类型
 */
export interface FileParseRequest {
  /** 文件ID */
  fileId: string;
  /** 是否跳过已存在的解析结果 */
  skipExist?: boolean;
}

export const FileParseRequestSchema = z.object({
  skipExist: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .nullish(),
});

/**
 * 文件解析响应类型
 */
export interface FileParseResponse {
  /** 解析后的文本内容 */
  content?: string;
  /** 解析错误信息 */
  error?: string;
  /** 文件ID */
  fileId: string;
  /** 文件类型 */
  fileType: string;
  /** 文档元数据 */
  metadata?: {
    /** 页数 */
    pages?: number;
    /** 文档标题 */
    title?: string;
    /** 字符总数 */
    totalCharCount?: number;
    /** 行总数 */
    totalLineCount?: number;
  };
  /** 文件名 */
  name: string;
  /** 解析时间 */
  parsedAt?: string;
  /** 解析状态 */
  parseStatus: 'completed' | 'failed';
}

// ==================== File Chunking Types ====================

/**
 * 文件分块任务请求
 */
export interface FileChunkRequest {
  /** 是否在分块成功后自动触发嵌入任务（可覆盖服务端默认开关） */
  autoEmbedding?: boolean;
  /** 是否跳过已存在分块任务（或已存在的分块结果） */
  skipExist?: boolean;
}

export const FileChunkRequestSchema = z.object({
  autoEmbedding: z.boolean().optional(),
  skipExist: z.boolean().optional(),
});

/**
 * 文件分块任务响应
 */
export interface FileChunkResponse {
  /** 分块异步任务ID */
  chunkTaskId?: string | null;
  /** 嵌入异步任务ID（仅当 autoEmbedding=true 时存在） */
  embeddingTaskId?: string | null;
  fileId: string;
  message?: string;
  /** 是否已触发 */
  success: boolean;
}

/**
 * 文件关联用户信息
 */
export interface FileUserItem {
  avatar?: string | null;
  email?: string | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

/**
 * 文件列表项（包含可选的分块状态信息）
 */
export interface FileListItem extends Partial<FileItem> {
  /** 分块任务信息（包含基础异步任务信息与分块数量） */
  chunking?: FileAsyncTaskResponse | null;
  /** 嵌入任务信息（包含基础异步任务信息） */
  embedding?: FileAsyncTaskResponse | null;
  /** 关联的知识库列表 */
  knowledgeBases?: Array<KnowledgeBaseItem>;
  /** 关联的用户列表（相同 fileHash 的所有用户） */
  users?: Array<FileUserItem>;
}

/**
 * 异步任务错误信息
 */
export interface AsyncTaskErrorResponse {
  /** 错误详情 */
  body: {
    detail: string;
  };
  /** 错误名称 */
  name: string;
}

/**
 * 文件相关异步任务基础信息（用于列表中的 chunking/embedding 字段）
 */
export interface FileAsyncTaskResponse {
  /** 分块数量（仅 chunking 任务会返回） */
  count?: number | null;
  /** 异步任务错误信息 */
  error?: AsyncTaskErrorResponse | null;
  /** 异步任务 ID */
  id?: string;
  /** 异步任务状态 */
  status?: 'pending' | 'processing' | 'success' | 'error' | null;
  /** 异步任务类型 */
  type?: 'chunk' | 'embedding' | 'image_generation';
}

/**
 * 文件分块状态响应
 */
export interface FileChunkStatusResponse {
  /** 分块数量 */
  chunkCount: number | null;
  /** 分块任务错误信息 */
  chunkingError?: AsyncTaskErrorResponse | null;
  /** 分块任务状态 */
  chunkingStatus?: 'pending' | 'processing' | 'success' | 'error' | null;
  /** 嵌入任务错误信息 */
  embeddingError?: AsyncTaskErrorResponse | null;
  /** 嵌入任务状态 */
  embeddingStatus?: 'pending' | 'processing' | 'success' | 'error' | null;
  /** 嵌入任务是否已完成 */
  finishEmbedding?: boolean;
}

// ==================== Common Schemas ====================

export const FileIdParamSchema = z.object({
  id: z.string().min(1, '文件 ID 不能为空'),
});

// ==================== File Update Types ====================

/**
 * 文件更新请求类型
 */
export interface UpdateFileRequest {
  /** 知识库ID（可选） */
  knowledgeBaseId?: string | null;
}

export const UpdateFileSchema = z.object({
  knowledgeBaseId: z.string().nullable().optional(),
});
