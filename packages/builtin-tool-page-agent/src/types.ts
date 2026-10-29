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
  /** Whether the edits are review diffs that only apply after the user accepts them. */
  pendingReview?: boolean;
  results: Array<{
    action: 'insert' | 'remove' | 'modify';
    error?: string;
    /** Whether this operation landed as a pending review diff. */
    pendingReview?: boolean;
    success: boolean;
  }>;
  successCount: number;
  totalCount: number;
}

export interface ReplaceTextState {
  /** Whether the replacements are review diffs that only apply after the user accepts them. */
  pendingReview?: boolean;
  /** IDs of nodes that were modified */
  modifiedNodeIds: string[];
  /** Number of replacements made */
  replacementCount: number;
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
