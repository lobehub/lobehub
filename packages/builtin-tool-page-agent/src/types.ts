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

// ============ Initialize Args ============
export interface InitDocumentArgs {
  markdown: string;
}

// ============ Document Metadata Args ============
export interface EditTitleArgs {
  title: string;
}

// ============ Query & Search Args ============
export interface GetPageContentArgs {
  format?: 'xml' | 'markdown' | 'both';
}

// ============ Unified Modify Nodes Args ============

/** Insert operation: insert a node before or after a reference node */
export type ModifyInsertOperation =
  | {
      action: 'insert';
      afterId: string;
      litexml: string;
    }
  | {
      action: 'insert';
      beforeId: string;
      litexml: string;
    };

/** Remove operation: remove a node by ID */
export interface ModifyRemoveOperation {
  action: 'remove';
  id: string;
}

/** Modify operation: update existing nodes by their IDs (embedded in litexml) */
export interface ModifyUpdateOperation {
  action: 'modify';
  litexml: string | string[];
}

/** Union type for all modify operations */
export type ModifyOperation = ModifyInsertOperation | ModifyRemoveOperation | ModifyUpdateOperation;

/** Args for the unified modifyNodes API */
export interface ModifyNodesArgs {
  operations: ModifyOperation[];
}

// ============ Text Operations Args ============
export interface ReplaceTextArgs {
  newText: string;
  nodeIds?: string[];
  replaceAll?: boolean;
  searchText: string;
  useRegex?: boolean;
}

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

/** Result of a single modify operation */
export interface ModifyOperationResult {
  action: 'insert' | 'remove' | 'modify';
  error?: string;
  success: boolean;
}

export interface ModifyNodesState {
  results: ModifyOperationResult[];
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

// ============ Runtime Result Types ============
// These are the raw result types returned by Runtime methods
// Executor is responsible for converting these to BuiltinToolResult format

export interface InitPageRuntimeResult {
  extractedTitle?: string;
  nodeCount: number;
}

export interface EditTitleRuntimeResult {
  newTitle: string;
  previousTitle: string;
}

export interface GetPageContentRuntimeResult {
  charCount?: number;
  documentId: string;
  lineCount?: number;
  markdown?: string;
  title: string;
  xml?: string;
}

export interface ModifyNodesRuntimeResult {
  results: ModifyOperationResult[];
  successCount: number;
  totalCount: number;
}

export interface ReplaceTextRuntimeResult {
  modifiedNodeIds: string[];
  replacementCount: number;
}
