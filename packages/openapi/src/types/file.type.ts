import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PUBLIC_FILE_FIELDS, PublicFile, PublicKnowledgeBase } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, jsonObjectSchema, PaginationQuerySchema } from './common.type';

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

const MultipartOptionalIdSchema = z.string().trim().min(1).max(255).optional();
const MultipartOptionalPathSchema = z.string().trim().min(1).max(1024).optional();
const MultipartBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const FileUploadFormFieldsSchema = z
  .object({
    agentId: MultipartOptionalIdSchema,
    directory: MultipartOptionalPathSchema,
    knowledgeBaseId: MultipartOptionalIdSchema,
    sessionId: MultipartOptionalIdSchema,
    skipCheckFileType: MultipartBooleanSchema,
    skipDeduplication: MultipartBooleanSchema,
  })
  .strict();

export const BatchFileUploadFormFieldsSchema = FileUploadFormFieldsSchema.omit({
  skipDeduplication: true,
});

export type FileUploadFormFields = z.infer<typeof FileUploadFormFieldsSchema>;
export type BatchFileUploadFormFields = z.infer<typeof BatchFileUploadFormFieldsSchema>;

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
  fileIds: z
    .array(z.string().min(1, 'File ID cannot be empty'))
    .min(1, 'File ID list cannot be empty'),
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
export interface FileListItem extends Partial<PublicFile> {
  /** Chunking task info (includes basic async task info and chunk count) */
  chunking?: FileAsyncTaskResponse | null;
  /** Embedding task info (includes basic async task info) */
  embedding?: FileAsyncTaskResponse | null;
  /** Associated knowledge base list */
  knowledgeBases?: Array<PublicKnowledgeBase>;
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
  id: z.string().min(1, 'File ID cannot be empty'),
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
  knowledgeBaseId: z.string().nullish(),
});

// ==================== Response Schemas ====================

const ASYNC_TASK_STATUSES = ['error', 'pending', 'processing', 'success'] as const;

/** Every column `projectPublicFile` copies, so a new public field fails to compile here. */
const fileShape = {
  createdAt: dateTimeSchema,
  fileType: z.string(),
  id: z.string(),
  metadata: jsonObjectSchema.nullable(),
  name: z.string(),
  parentId: z.string().nullable(),
  size: z.number().int(),
  source: z.string().nullable(),
  updatedAt: dateTimeSchema,
  /** Full URL: relative storage keys are expanded before the file is returned. */
  url: z.string(),
  visibility: z.enum(['private', 'public']),
} satisfies Record<(typeof PUBLIC_FILE_FIELDS)[number], z.ZodType>;

export const FileSchema = z.object(fileShape).strict().meta({ id: 'File' });

/** How an async chunking / embedding task failed, as stored on the task row. */
export const AsyncTaskErrorSchema = z
  .object({
    body: z.union([
      z.string(),
      z.object({ detail: z.string(), retryAt: dateTimeSchema.optional() }),
    ]),
    name: z.string(),
  })
  .meta({ id: 'AsyncTaskError' });

export const FileAsyncTaskSchema = z
  .object({
    /** Chunk count; only reported on the chunking task. */
    count: z.number().int().nullable().optional(),
    error: AsyncTaskErrorSchema.nullable(),
    /** Absent when the file has chunks but its chunking task row is gone. */
    id: z.string().optional(),
    status: z.enum(ASYNC_TASK_STATUSES).nullable(),
    type: z.enum(['chunk', 'embedding']).optional(),
  })
  .strict()
  .meta({ id: 'FileAsyncTask' });

/** Knowledge base a listed file belongs to (only the columns the list joins). */
export const FileKnowledgeBaseRefSchema = z
  .object({
    avatar: z.string().nullable(),
    description: z.string().nullable(),
    id: z.string(),
    name: z.string(),
  })
  .strict()
  .meta({ id: 'FileKnowledgeBaseRef' });

/** Owner of a listed file (every owner of the same content when the caller has global read). */
export const FileUserSchema = z
  .object({
    avatar: z.string().nullable(),
    email: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    username: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'FileUser' });

export const FileListItemSchema = FileSchema.extend({
  chunking: FileAsyncTaskSchema.nullable(),
  embedding: FileAsyncTaskSchema.nullable(),
  knowledgeBases: z.array(FileKnowledgeBaseRefSchema),
  users: z.array(FileUserSchema),
})
  .strict()
  .meta({ id: 'FileListItem' });

export const FileListResponseSchema = z
  .object({
    ...pageInfoShape,
    /** Files sharing the same content hash are listed once. */
    files: z.array(FileListItemSchema),
    ...totalShape,
    /** Sum of the matched files' sizes in bytes, as a decimal string. */
    totalSize: z.string(),
  })
  .strict()
  .meta({ id: 'FileList' });

export const FileParseResultSchema = z
  .object({
    /** Absent when the detail lookup could not parse the file; null for an empty stored document. */
    content: z.string().nullable().optional(),
    error: z.string().optional(),
    fileId: z.string(),
    fileType: z.string(),
    metadata: z
      .object({
        pages: z.number().int().min(0),
        title: z.string().optional(),
        totalCharCount: z.number().int().optional(),
        totalLineCount: z.number().int().optional(),
      })
      .strict()
      .optional(),
    name: z.string(),
    parseStatus: z.enum(['completed', 'failed']),
    parsedAt: dateTimeSchema.optional(),
  })
  .strict()
  .meta({ id: 'FileParseResult' });

export const FileDetailSchema = z
  .object({
    file: FileSchema,
    /** Parse result; absent for images, which are never parsed. */
    parsed: FileParseResultSchema.optional(),
  })
  .strict()
  .meta({ id: 'FileDetail' });

export const FileUrlResponseSchema = z
  .object({
    expiresAt: dateTimeSchema,
    expiresIn: z.number().int(),
    fileId: z.string(),
    name: z.string(),
    /** Pre-signed URL, valid for `expiresIn` seconds. */
    url: z.string(),
  })
  .strict()
  .meta({ id: 'FileUrl' });

export const BatchFileUploadResponseSchema = z
  .object({
    failed: z.array(z.object({ error: z.string(), name: z.string() }).strict()),
    successful: z.array(FileDetailSchema),
    summary: z
      .object({
        failed: z.number().int().min(0),
        successful: z.number().int().min(0),
        total: z.number().int().min(0),
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'BatchFileUploadResult' });

export const BatchGetFilesResponseSchema = z
  .object({
    failed: z.array(z.object({ error: z.string(), fileId: z.string() }).strict()),
    files: z.array(FileDetailSchema),
    success: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'BatchGetFilesResult' });

export const FileChunkTaskResponseSchema = z
  .object({
    chunkTaskId: z.string().nullable(),
    /** Set only when `autoEmbedding` was requested. */
    embeddingTaskId: z.string().nullable(),
    fileId: z.string(),
    message: z.string(),
    success: z.literal(true),
  })
  .strict()
  .meta({ id: 'FileChunkTask' });

export const FileChunkStatusResponseSchema = z
  .object({
    chunkCount: z.number().int().min(0),
    chunkingError: AsyncTaskErrorSchema.nullable(),
    chunkingStatus: z.enum(ASYNC_TASK_STATUSES).nullable(),
    embeddingError: AsyncTaskErrorSchema.nullable(),
    embeddingStatus: z.enum(ASYNC_TASK_STATUSES).nullable(),
    finishEmbedding: z.boolean(),
  })
  .strict()
  .meta({ id: 'FileChunkStatus' });
