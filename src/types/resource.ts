import type { FilesTabs, SortType } from '@/types/files';

/**
 * Unified resource item that represents both files and documents
 * Used by ResourceManager for optimistic updates and local-first state management
 */
export interface ResourceItem {
  // Identity
  id: string; // Real ID or temp-resource-{timestamp}-{random}

  // Common fields
  name: string;
  fileType: string; // MIME type or custom/folder, custom/document
  size: number; // bytes for files, char count for documents
  sourceType: 'file' | 'document';

  // Hierarchy
  parentId?: string | null;
  knowledgeBaseId?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // File-specific (optional)
  url?: string;
  chunkTaskId?: string | null;
  embeddingTaskId?: string | null;
  chunkCount?: number | null;
  chunkingStatus?: string | null;
  chunkingError?: any | null;
  embeddingStatus?: string | null;
  embeddingError?: any | null;
  finishEmbedding?: boolean;

  // Document-specific (optional)
  content?: string | null;
  editorData?: Record<string, any> | null;
  slug?: string | null;
  title?: string;

  // Metadata
  metadata?: Record<string, any>;

  // Optimistic tracking (UI state, not persisted)
  _optimistic?: {
    isPending: boolean;
    error?: Error;
    lastSyncAttempt?: Date;
    retryCount: number;
  };
}

/**
 * Sync operation queued for background processing
 */
export interface SyncOperation {
  id: string; // Operation ID (sync-{resourceId}-{timestamp})
  resourceId: string; // Resource ID (temp or real)
  type: 'create' | 'update' | 'delete' | 'move';
  payload: any;
  timestamp: Date;
  retryCount: number;
}

/**
 * Query parameters for fetching resources
 */
export interface ResourceQueryParams {
  category?: FilesTabs;
  q?: string;
  knowledgeBaseId?: string;
  parentId?: string | null;
  showFilesInKnowledgeBase?: boolean;
  sortType?: SortType;
  sorter?: 'name' | 'createdAt' | 'size';
  limit?: number;
  offset?: number;
}

/**
 * Create operation payload for files
 */
export interface CreateFileParams {
  name: string;
  fileType: string;
  size: number;
  url: string;
  sourceType: 'file';
  parentId?: string;
  knowledgeBaseId?: string;
  metadata?: Record<string, any>;
}

/**
 * Create operation payload for documents
 */
export interface CreateDocumentParams {
  title: string;
  content: string;
  fileType: 'custom/document' | 'custom/folder';
  sourceType: 'document';
  parentId?: string;
  knowledgeBaseId?: string;
  slug?: string;
  editorData?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Union type for create operations
 */
export type CreateResourceParams = CreateFileParams | CreateDocumentParams;

/**
 * Update operation payload
 */
export interface UpdateResourceParams {
  name?: string;
  title?: string;
  content?: string;
  parentId?: string | null;
  metadata?: Record<string, any>;
  editorData?: Record<string, any>;
}
