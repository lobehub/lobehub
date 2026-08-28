import { z } from 'zod';

import type { AsyncTaskStatus, FileParsingTask } from '../asyncTask';

export interface KnowledgeItemStatus extends FileParsingTask {
  id: string;
}

export interface FileUploader {
  avatar?: string | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

export interface FileListItem {
  chunkCount: number | null;
  chunkingError: any | null;
  chunkingStatus?: AsyncTaskStatus | null;
  /**
   * Text content of the document (for notes/documents)
   */
  content?: string | null;
  createdAt: Date;
  editorData?: Record<string, any> | null;
  embeddingError: any | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileId?: string | null;
  fileType: string;
  finishEmbedding: boolean;
  id: string;
  /**
   * Metadata (for notes/documents)
   */
  metadata?: Record<string, any> | null;
  name: string;
  /**
   * Parent folder ID (for folder hierarchy)
   */
  parentId?: string | null;
  size: number;
  slug?: string | null;
  sourceType: string;
  updatedAt: Date;
  /**
   * The user who uploaded the file. Populated by the server list query when
   * available; falls back to `null` for rows without a joinable user (rare,
   * e.g. deleted accounts) or when the caller doesn't need it.
   */
  uploader?: FileUploader | null;
  url: string;
  userId?: string | null;
  /**
   * Workspace visibility. `null` (or absent) means the row predates the
   * column / is in personal mode. UI uses this together with `userId` to
   * surface the lock icon and the publish-to-workspace affordance.
   */
  visibility?: 'private' | 'public' | null;
}

export enum SortType {
  Asc = 'asc',
  Desc = 'desc',
}

/**
 * How a resource came to exist, as the explorer lets the user narrow it.
 * Reads `files.source`, which is NULL for everything a human put there.
 *
 * `Acceptance` is the one value that widens the result set rather than
 * narrowing it: verification evidence is hidden from every listing by default
 * (`LIBRARY_HIDDEN_FILE_SOURCES`) and only comes back when explicitly asked for.
 */
export enum ResourceSourceFilter {
  Acceptance = 'acceptance',
  All = 'all',
  Generated = 'generated',
  Uploaded = 'uploaded',
}

export const QueryFileListSchema = z.object({
  category: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  limit: z.number().int().positive().default(50),
  offset: z.number().int().min(0).default(0),
  parentId: z.string().nullish(),
  q: z.string().nullish(),
  showFilesInKnowledgeBase: z.boolean().default(false),
  sortType: z.enum(['desc', 'asc']).optional(),
  sorter: z.enum(['createdAt', 'size']).optional(),
  /**
   * Origin narrowing driven by the explorer's source filter. Absent / `all`
   * keeps the historical pool (everything except hidden sources).
   */
  sourceFilter: z.nativeEnum(ResourceSourceFilter).optional(),
  /**
   * Workspace-mode visibility filter. Absent / undefined means "all"
   * (already ownership-filtered by the server). `'private'` narrows to
   * the caller's own private rows; `'public'` narrows to workspace-shared
   * rows. Ignored in personal mode.
   */
  visibility: z.enum(['private', 'public']).optional(),
});

export type QueryFileListSchemaType = z.infer<typeof QueryFileListSchema>;

export interface QueryFileListParams {
  category?: string;
  knowledgeBaseId?: string;
  limit?: number;
  offset?: number;
  parentId?: string | null;
  q?: string | null;
  showFilesInKnowledgeBase?: boolean;
  sorter?: string;
  sortType?: string;
  sourceFilter?: ResourceSourceFilter;
  visibility?: 'private' | 'public';
}

export interface PaginatedFileList {
  hasMore: boolean;
  items: FileListItem[];
  total?: number;
}
