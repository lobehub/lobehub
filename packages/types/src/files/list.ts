import { z } from 'zod';

import type { AsyncTaskStatus } from '../asyncTask';

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
  url: string;
}

export enum SortType {
  Asc = 'asc',
  Desc = 'desc',
}

export const QueryFileListSchema = z.object({
  category: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  limit: z.number().int().positive().default(50),
  offset: z.number().int().min(0).default(0),
  parentId: z.string().nullable().optional(),
  q: z.string().nullable().optional(),
  showFilesInKnowledgeBase: z.boolean().default(false),
  sortType: z.enum(['desc', 'asc']).optional(),
  sorter: z.enum(['createdAt', 'size']).optional(),
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
}

export interface PaginatedFileList {
  hasMore: boolean;
  items: FileListItem[];
  total?: number;
}
