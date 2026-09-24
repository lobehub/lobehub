import {
  type FilesTabs,
  type FileUploader,
  type ResourceListSorter,
  type ResourceSourceFilter,
  type SortType,
} from '@/types/files';

/** JSON object stored on a resource. Values are narrowed at the use site. */
type ResourceJson = Record<string, unknown>;

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
  contentPreview?: string | null;
  // Timestamps
  createdAt: Date;

  editorData?: ResourceJson | null;
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
  metadata?: ResourceJson;
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
  uploader?: FileUploader | null;

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
  includeContentPreview?: boolean;
  libraryId?: string;
  limit?: number;
  offset?: number;
  parentId?: string | null;
  q?: string;
  showFilesInKnowledgeBase?: boolean;
  sorter?: ResourceListSorter;
  sortType?: SortType;
  /**
   * Origin narrowing driven by the explorer's source filter chips
   * (all / AI-generated / uploaded / acceptance evidence).
   */
  sourceFilter?: ResourceSourceFilter;
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
  metadata?: ResourceJson;
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
  editorData?: ResourceJson;
  fileType: 'custom/document' | 'custom/folder';
  knowledgeBaseId?: string;
  metadata?: ResourceJson;
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
  editorData?: ResourceJson;
  metadata?: ResourceJson;
  name?: string;
  parentId?: string | null;
  title?: string;
}
