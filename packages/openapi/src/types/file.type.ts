import { z } from 'zod';

import type { FileItem, KnowledgeBaseItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== File Upload Types ====================

/**
 * File upload request type
 */
export interface FileUploadRequest {
  /** Agent ID (optional, takes priority over sessionId) */
  agentId?: string;
  /** File directory (optional) */
  directory?: string;
  /** File object */
  file: File;
  /** Knowledge base ID (optional) */
  knowledgeBaseId?: string;
  /** Custom path (optional) */
  pathname?: string;
  /** Session ID (optional) */
  sessionId?: string;
  /** Whether to skip file type check */
  skipCheckFileType?: boolean;
  /** Whether to skip deduplication check */
  skipDeduplication?: boolean;
}

/**
 * File detail response type
 */
export interface FileDetailResponse {
  file: FileListItem;
  parsed?: FileParseResponse;
}

/**
 * Public file upload request type
 */
export interface PublicFileUploadRequest {
  /** Agent ID (optional, takes priority over sessionId) */
  agentId?: string;
  /** File directory (optional) */
  directory?: string;
  /** Knowledge base ID (optional) */
  knowledgeBaseId?: string;
  /** Session ID (optional) */
  sessionId?: string;
  /** Whether to skip file type check */
  skipCheckFileType?: boolean;
  /** Whether to skip deduplication check */
  skipDeduplication?: boolean;
}

// ==================== File Management Types ====================

/**
 * File list query parameters
 */
export interface FileListQuery extends IPaginationQuery {
  /** File type filter */
  fileType?: string;
  /** Knowledge base ID filter */
  knowledgeBaseId?: string;
  /** Whether to query all data (requires ALL permission) */
  queryAll?: boolean;
  /** Updated time end */
  updatedAtEnd?: string;
  /** Updated time start */
  updatedAtStart?: string;
  /** User ID */
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
 * File list response type
 */
export type FileListResponse = PaginationQueryResponse<{
  /** File list */
  files: FileDetailResponse['file'][];
  /** Total file size */
  totalSize?: string;
}>;

// ==================== File URL Types ====================

/**
 * File URL request type
 */
export interface FileUrlRequest {
  /** Expiry time (seconds), defaults to system configured value */
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
 * File URL response type
 */
export interface FileUrlResponse {
  /** URL expiry timestamp */
  expiresAt: string;
  /** URL expiry time (seconds) */
  expiresIn: number;
  /** File ID */
  fileId: string;
  /** Filename */
  name: string;
  /** Pre-signed access URL */
  url: string;
}

// ==================== Batch Operations ====================

/**
 * Batch file upload request type
 */
export interface BatchFileUploadRequest {
  /** Agent ID (optional, takes priority over sessionId) */
  agentId?: string;
  /** Upload directory (optional) */
  directory?: string;
  /** File list */
  files: File[];
  /** Knowledge base ID (optional) */
  knowledgeBaseId?: string;
  /** Session ID (optional) */
  sessionId?: string;
  /** Whether to skip file type check */
  skipCheckFileType?: boolean;
}

/**
 * Batch file upload response type
 */
export interface BatchFileUploadResponse {
  /** Failed files and error messages */
  failed: Array<{
    error: string;
    name: string;
  }>;
  /** Successfully uploaded files */
  successful: FileDetailResponse[];
  /** Total count */
  summary: {
    failed: number;
    successful: number;
    total: number;
  };
}

/**
 * Batch get files request type
 */
export interface BatchGetFilesRequest {
  /** File ID list */
  fileIds: string[];
}

export const BatchGetFilesRequestSchema = z.object({
  fileIds: z.array(z.string().min(1, '文件ID不能为空')).min(1, '文件ID列表不能为空'),
});

/**
 * Batch get files response type
 */
export interface BatchGetFilesResponse {
  /** Failed files and error messages */
  failed: Array<{
    error: string;
    fileId: string;
  }>;
  /** File list */
  files: Array<FileDetailResponse>;
  /** Number of successfully retrieved files */
  success: number;
  /** Total number of requests */
  total: number;
}

// ==================== File Parsing Types ====================

/**
 * File parse request type
 */
export interface FileParseRequest {
  /** File ID */
  fileId: string;
  /** Whether to skip existing parse results */
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
 * File parse response type
 */
export interface FileParseResponse {
  /** Parsed text content */
  content?: string;
  /** Parse error message */
  error?: string;
  /** File ID */
  fileId: string;
  /** File type */
  fileType: string;
  /** Document metadata */
  metadata?: {
    /** Number of pages */
    pages?: number;
    /** Document title */
    title?: string;
    /** Total character count */
    totalCharCount?: number;
    /** Total line count */
    totalLineCount?: number;
  };
  /** Filename */
  name: string;
  /** Parse time */
  parsedAt?: string;
  /** Parse status */
  parseStatus: 'completed' | 'failed';
}

// ==================== File Chunking Types ====================

/**
 * File chunking task request
 */
export interface FileChunkRequest {
  /** Whether to automatically trigger embedding task after chunking succeeds (can override server default) */
  autoEmbedding?: boolean;
  /** Whether to skip existing chunking tasks (or existing chunked results) */
  skipExist?: boolean;
}

export const FileChunkRequestSchema = z.object({
  autoEmbedding: z.boolean().optional(),
  skipExist: z.boolean().optional(),
});

/**
 * File chunking task response
 */
export interface FileChunkResponse {
  /** Chunk async task ID */
  chunkTaskId?: string | null;
  /** Embedding async task ID (only present when autoEmbedding=true) */
  embeddingTaskId?: string | null;
  fileId: string;
  message?: string;
  /** Whether it has been triggered */
  success: boolean;
}

/**
 * File associated user info
 */
export interface FileUserItem {
  avatar?: string | null;
  email?: string | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

/**
 * File list item (includes optional chunking status info)
 */
export interface FileListItem extends Partial<FileItem> {
  /** Chunking task info (includes basic async task info and chunk count) */
  chunking?: FileAsyncTaskResponse | null;
  /** Embedding task info (includes basic async task info) */
  embedding?: FileAsyncTaskResponse | null;
  /** Associated knowledge base list */
  knowledgeBases?: Array<KnowledgeBaseItem>;
  /** Associated user list (all users with the same fileHash) */
  users?: Array<FileUserItem>;
}

/**
 * Async task error info
 */
export interface AsyncTaskErrorResponse {
  /** Error details */
  body: {
    detail: string;
  };
  /** Error name */
  name: string;
}

/**
 * File async task basic info (used for chunking/embedding fields in the list)
 */
export interface FileAsyncTaskResponse {
  /** Chunk count (only returned by chunking tasks) */
  count?: number | null;
  /** Async task error info */
  error?: AsyncTaskErrorResponse | null;
  /** Async task ID */
  id?: string;
  /** Async task status */
  status?: 'pending' | 'processing' | 'success' | 'error' | null;
  /** Async task type */
  type?: 'chunk' | 'embedding' | 'image_generation';
}

/**
 * File chunking status response
 */
export interface FileChunkStatusResponse {
  /** Chunk count */
  chunkCount: number | null;
  /** Chunking task error info */
  chunkingError?: AsyncTaskErrorResponse | null;
  /** Chunking task status */
  chunkingStatus?: 'pending' | 'processing' | 'success' | 'error' | null;
  /** Embedding task error info */
  embeddingError?: AsyncTaskErrorResponse | null;
  /** Embedding task status */
  embeddingStatus?: 'pending' | 'processing' | 'success' | 'error' | null;
  /** Whether the embedding task has completed */
  finishEmbedding?: boolean;
}

// ==================== Common Schemas ====================

export const FileIdParamSchema = z.object({
  id: z.string().min(1, '文件 ID 不能为空'),
});

// ==================== File Update Types ====================

/**
 * File update request type
 */
export interface UpdateFileRequest {
  /** Knowledge base ID (optional) */
  knowledgeBaseId?: string | null;
}

export const UpdateFileSchema = z.object({
  knowledgeBaseId: z.string().nullable().optional(),
});
