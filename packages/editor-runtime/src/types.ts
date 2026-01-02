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

// ============ Runtime Result Types ============

/** Result of a single modify operation */
export interface ModifyOperationResult {
  action: 'insert' | 'remove' | 'modify';
  error?: string;
  success: boolean;
}

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
