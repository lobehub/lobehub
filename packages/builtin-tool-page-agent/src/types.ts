/**
 * Page Agent / Document Tool identifier
 */
export const PageAgentIdentifier = 'lobe-page-agent';

/* eslint-disable sort-keys-fix/sort-keys-fix */
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
/* eslint-enable sort-keys-fix/sort-keys-fix */

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
