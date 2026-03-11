import { type FilesTabs, type SortType } from '@/types/files';

/**
 * Unified resource item that represents both files and documents
 * Used by ResourceManager for optimistic updates and local-first state management
 */
export interface ResourceItem {
  // Optimistic tracking (UI state, not persisted)
  _optimistic?: {
    error?: Error;
    isPending: boolean;
    lastSyncAttempt?: Date;
    retryCount: number;
  };

  chunkCount?: number | null;
  chunkingError?: any | null;
  chunkingStatus?: string | null;
  chunkTaskId?: string | null;

  // Document-specific (optional)
  content?: string | null;
  // Timestamps
  createdAt: Date;

  editorData?: Record<string, any> | null;
  embeddingError?: any | null;

  embeddingStatus?: string | null;
  embeddingTaskId?: string | null;
  fileType: string;
  finishEmbedding?: boolean;
  // Identity
  id: string;
  knowledgeBaseId?: string;
  // Metadata
  metadata?: Record<string, any>;
  // Real ID or temp-resource-{timestamp}-{random}
  // Common fields
  name: string;
  // Hierarchy
  parentId?: string | null;

  // MIME type or custom/folder, custom/document
  size: number;
  slug?: string | null;
  // bytes for files, char count for documents
  sourceType: 'file' | 'document';
  title?: string;

  updatedAt: Date;

  // File-specific (optional)
  url?: string;
}

/**
 * Sync operation queued for background processing
 */
export interface SyncOperation {
  id: string;
  payload: any;
  reject?: (reason?: any) => void;
  // Promise resolver for async operations
  resolve?: (value?: any) => void;
  // Operation ID (sync-{resourceId}-{timestamp})
  resourceId: string;
  retryCount: number;
  timestamp: Date;
  // Resource ID (temp or real)
  type: 'create' | 'update' | 'delete' | 'move';
}

/**
 * Query parameters for fetching resources
 */
export interface ResourceQueryParams {
  category?: FilesTabs;
  libraryId?: string;
  limit?: number;
  offset?: number;
  parentId?: string | null;
  q?: string;
  showFilesInKnowledgeBase?: boolean;
  sorter?: 'name' | 'createdAt' | 'size';
  sortType?: SortType;
}

/**
 * Create operation payload for files
 */
export interface CreateFileParams {
  fileType: string;
  knowledgeBaseId?: string;
  metadata?: Record<string, any>;
  name: string;
  parentId?: string;
  size: number;
  sourceType: 'file';
  url: string;
}

/**
 * Create operation payload for documents
 */
export interface CreateDocumentParams {
  content: string;
  editorData?: Record<string, any>;
  fileType: 'custom/document' | 'custom/folder';
  knowledgeBaseId?: string;
  metadata?: Record<string, any>;
  parentId?: string;
  slug?: string;
  sourceType: 'document';
  title: string;
}

/**
 * Union type for create operations
 */
export type CreateResourceParams = CreateFileParams | CreateDocumentParams;

/**
 * Update operation payload
 */
export interface UpdateResourceParams {
  content?: string;
  editorData?: Record<string, any>;
  metadata?: Record<string, any>;
  name?: string;
  parentId?: string | null;
  title?: string;
}
