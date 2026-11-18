import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PUBLIC_KNOWLEDGE_BASE_FIELDS, PublicKnowledgeBase } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, jsonObjectSchema, PaginationQuerySchema } from './common.type';

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
  fileIds: z
    .array(z.string().min(1, 'File ID cannot be empty'))
    .min(1, 'File ID list cannot be empty'),
});

/**
 * Knowledge base file move request
 */
export interface MoveKnowledgeBaseFilesRequest extends KnowledgeBaseFileBatchRequest {
  /** Target knowledge base ID */
  targetKnowledgeBaseId: string;
}

export const MoveKnowledgeBaseFilesSchema = KnowledgeBaseFileBatchSchema.extend({
  targetKnowledgeBaseId: z.string().min(1, 'Target knowledge base ID cannot be empty'),
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

export interface KnowledgeBaseListItem extends PublicKnowledgeBase {
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
  id: z.string().min(1, 'Knowledge base ID cannot be empty'),
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
  avatar: z.string().url('Avatar must be a valid URL').optional(),
  description: z.string().max(1000, 'Knowledge base description is too long').optional(),
  name: z
    .string()
    .min(1, 'Knowledge base name cannot be empty')
    .max(255, 'Knowledge base name is too long'),
});

/**
 * Create knowledge base response type
 */
export interface CreateKnowledgeBaseResponse {
  /** Knowledge base info */
  knowledgeBase: PublicKnowledgeBase;
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
  avatar: z.string().url('Avatar must be a valid URL').optional(),
  description: z.string().max(1000, 'Knowledge base description is too long').optional(),
  name: z
    .string()
    .min(1, 'Knowledge base name cannot be empty')
    .max(255, 'Knowledge base name is too long')
    .optional(),
});

/**
 * Knowledge base detail response type
 */
export interface KnowledgeBaseDetailResponse {
  /** Knowledge base info */
  knowledgeBase: PublicKnowledgeBase;
}

// ==================== Response Schemas ====================

/** Every column `projectPublicKnowledgeBase` copies, so a new public field fails to compile here. */
const knowledgeBaseShape = {
  avatar: z.string().nullable(),
  createdAt: dateTimeSchema,
  description: z.string().nullable(),
  id: z.string(),
  isPublic: z.boolean().nullable(),
  name: z.string(),
  settings: jsonObjectSchema.nullable(),
  /** `agent` / `project` for a dedicated library; null for an ordinary one. */
  type: z.string().nullable(),
  updatedAt: dateTimeSchema,
  visibility: z.enum(['private', 'public']),
} satisfies Record<(typeof PUBLIC_KNOWLEDGE_BASE_FIELDS)[number], z.ZodType>;

export const KnowledgeBaseSchema = z
  .object(knowledgeBaseShape)
  .strict()
  .meta({ id: 'KnowledgeBase' });

export const KnowledgeBaseListItemSchema = KnowledgeBaseSchema.extend({
  /** How the caller reaches this knowledge base. */
  accessType: z.enum(['owner', 'userGrant', 'roleGrant', 'public']),
})
  .strict()
  .meta({ id: 'KnowledgeBaseListItem' });

export const KnowledgeBaseListResponseSchema = z
  .object({
    ...pageInfoShape,
    knowledgeBases: z.array(KnowledgeBaseListItemSchema),
    ...totalShape,
  })
  .strict()
  .meta({ id: 'KnowledgeBaseList' });

/** Detail, create and update all wrap the knowledge base under `knowledgeBase`. */
export const KnowledgeBaseDetailResponseSchema = z
  .object({ knowledgeBase: KnowledgeBaseSchema })
  .strict()
  .meta({ id: 'KnowledgeBaseDetail' });

/**
 * Outcome of adding, removing or moving file associations. Files the caller
 * cannot reach are reported in `failed` instead of failing the whole call.
 */
export const KnowledgeBaseFileOperationResultSchema = z
  .object({
    failed: z.array(z.object({ fileId: z.string(), reason: z.string() }).strict()),
    /** Ids of the files the operation applied to (spelling kept for compatibility). */
    successed: z.array(z.string()),
  })
  .strict()
  .meta({ id: 'KnowledgeBaseFileOperationResult' });
