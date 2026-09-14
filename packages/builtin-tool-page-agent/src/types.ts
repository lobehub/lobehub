/**
 * Page Agent / Document Tool identifier
 */
export const PageAgentIdentifier = 'lobe-page-agent';

export const DocumentApiName = {
  // Initialize
  initPage: 'initPage',

  // Document Metadata
  editTitle: 'editTitle',

  // Query & Read
  getPageContent: 'getPageContent',

  // Unified CRUD
  modifyNodes: 'modifyNodes',

  // Text Operations
  replaceText: 'replaceText',

  // Collaborative targeted rewrite
  rewriteSelection: 'rewriteSelection',
};

// ============ State Types for Renders ============

export interface GetPageContentState {
  documentId: string;
  markdown?: string;
  metadata: {
    fileType?: string;
    title: string;
    totalCharCount?: number;
    totalLineCount?: number;
  };
  xml?: string;
}

export interface ModifyNodesState {
  results: Array<{
    action: 'insert' | 'remove' | 'modify';
    error?: string;
    success: boolean;
  }>;
  successCount: number;
  totalCount: number;
}

export interface ReplaceTextState {
  /** IDs of nodes that were modified */
  modifiedNodeIds: string[];
  /** Number of replacements made */
  replacementCount: number;
}

/**
 * Input for the collaborative targeted-rewrite bridge.
 *
 * The request (including its durable selection) must already exist. Keeping
 * the selection out of this tool is intentional: the request API owns anchor
 * validation and ACL, while this conversation tool only drives its queue.
 */
export interface RewriteSelectionArgs {
  instruction?: string;
  requestId: string;
}

export type RewriteProgressStage =
  | 'analyzing_context'
  | 'applying'
  | 'generating_replacement'
  | 'reading_block'
  | 'reading_search'
  | 'reading_structure'
  | 'syncing';

export interface RewriteProgressEvent {
  at: string;
  detail?: string;
  stage: RewriteProgressStage;
  summary?: string;
  tool?: string;
}

export interface RewriteProgress {
  currentStage: RewriteProgressStage;
  events: RewriteProgressEvent[];
  summary?: string;
  updatedAt: string;
}

/** Public, non-sensitive status envelope returned to the conversation. */
export interface RewriteSelectionState {
  attempt: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  parentRequestId?: string | null;
  progress?: RewriteProgress | null;
  requestId: string;
  sessionId?: string | null;
  status: string;
  turnIndex?: number;
  updatedAt?: string | null;
}

// ============ Initialize State ============
export interface InitDocumentState {
  nodeCount: number;
  rootId: string;
}

// ============ Document Metadata State ============
export interface EditTitleState {
  newTitle: string;
  previousTitle: string;
}
