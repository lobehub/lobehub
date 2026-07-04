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
    queryKey?: string;
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
  fileId?: string | null;
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

  // Workspace ownership (used by the Item components to decide whether to
  // render the private-lock badge). `userId` is the creator; `visibility` is
  // scoped to workspace mode — `null` when the row is in personal mode.
  userId?: string | null;
  visibility?: 'private' | 'public' | null;
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
  /**
   * Workspace-mode visibility narrowing driven by the Sidebar mode toggle.
   * `'private'` shows the caller's own private rows; `'public'` shows
   * workspace-shared rows. Omitted in personal mode.
   */
  visibility?: 'private' | 'public';
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
  /**
   * Optional workspace visibility carried through the optimistic path so the
   * lock badge stays consistent while the create request is in flight.
   * Server-side default kicks in when omitted.
   */
  visibility?: 'private' | 'public';
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
