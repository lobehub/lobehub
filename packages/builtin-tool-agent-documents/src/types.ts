export const AgentDocumentsIdentifier = 'lobe-agent-documents';

export const AgentDocumentsApiName = {
  createDocument: 'createDocument',
  copyDocument: 'copyDocument',
  listDocuments: 'listDocuments',
  modifyNodes: 'modifyNodes',
  readDocument: 'readDocument',
  removeDocument: 'removeDocument',
  renameDocument: 'renameDocument',
  replaceDocumentContent: 'replaceDocumentContent',
  updateLoadRule: 'updateLoadRule',
} as const;

export interface CreateDocumentArgs {
  content: string;
  hintIsSkill?: boolean;
  scope?: 'agent' | 'currentTopic';
  title: string;
}

export interface CreateDocumentState {
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the created document's Work. */
  agentId?: string;
  documentId?: string;
}

export interface ReadDocumentArgs {
  format?: 'xml' | 'markdown' | 'both';
  id: string;
}

export interface ReadDocumentState {
  content?: string;
  id: string;
  title?: string;
  xml?: string;
}

export interface ReplaceDocumentContentArgs {
  content: string;
  id: string;
}

export interface ReplaceDocumentContentState {
  /** The `agentDocuments` association row id. */
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the document's Work. */
  agentId?: string;
  /** The backing `documents` table row id — the Work resource identity. */
  documentId?: string;
  /** @deprecated Prefer {@link agentDocumentId}; same-meaning alias kept for historical states. */
  id: string;
  updated: boolean;
}

export type ModifyDocumentInsertOperation =
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

export interface ModifyDocumentUpdateOperation {
  action: 'modify';
  litexml: string | string[];
}

export interface ModifyDocumentRemoveOperation {
  action: 'remove';
  id: string;
}

export type ModifyDocumentOperation =
  ModifyDocumentInsertOperation | ModifyDocumentRemoveOperation | ModifyDocumentUpdateOperation;

export interface ModifyDocumentNodesArgs {
  id: string;
  operations: ModifyDocumentOperation[];
}

export interface ModifyDocumentNodesState {
  /** The `agentDocuments` association row id. */
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the document's Work. */
  agentId?: string;
  /** The backing `documents` table row id — the Work resource identity. */
  documentId?: string;
  /** @deprecated Prefer {@link agentDocumentId}; same-meaning alias kept for historical states. */
  id: string;
  results: Array<{
    action: 'insert' | 'remove' | 'modify';
    success: boolean;
  }>;
  successCount: number;
  totalCount: number;
}

export interface RemoveDocumentArgs {
  id: string;
}

export interface RemoveDocumentState {
  /** The `agentDocuments` association row id. */
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the document's Work. */
  agentId?: string;
  deleted: boolean;
  /** The backing `documents` table row id — the Work resource identity. */
  documentId?: string;
  /** @deprecated Prefer {@link agentDocumentId}; same-meaning alias kept for historical states. */
  id: string;
}

export interface RenameDocumentArgs {
  id: string;
  newTitle: string;
}

export interface RenameDocumentState {
  /** The `agentDocuments` association row id. */
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the document's Work. */
  agentId?: string;
  /** The backing `documents` table row id — the Work resource identity. */
  documentId?: string;
  /** @deprecated Prefer {@link agentDocumentId}; same-meaning alias kept for historical states. */
  id: string;
  newTitle: string;
  renamed: boolean;
}

export interface CopyDocumentArgs {
  id: string;
  newTitle?: string;
}

export interface CopyDocumentState {
  /** The new copy's `agentDocuments` association row id. */
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the copied document's Work. */
  agentId?: string;
  /** Source document's `agentDocuments` row id (NOT the new copy). */
  copiedFromId: string;
  /** The new copy's backing `documents` table row id — the Work resource identity. */
  documentId?: string;
  /** @deprecated Prefer {@link agentDocumentId}; same-meaning alias kept for historical states. */
  newDocumentId?: string;
}

export interface AgentDocumentLoadRule {
  keywordMatchMode?: 'all' | 'any';
  keywords?: string[];
  maxTokens?: number;
  policyLoadFormat?: 'file' | 'raw';
  priority?: number;
  regexp?: string;
  rule?: 'always' | 'by-keywords' | 'by-regexp' | 'by-time-range';
  timeRange?: {
    from?: string;
    to?: string;
  };
}

export interface UpdateLoadRuleArgs {
  id: string;
  rule: AgentDocumentLoadRule;
}

export interface UpdateLoadRuleState {
  applied: boolean;
  rule: AgentDocumentLoadRule;
}

export interface LoadRuleScope {
  agentId?: string;
  sessionId?: string;
  topicId?: string;
}

export interface AgentDocumentReference {
  id: string;
  title?: string;
}

export interface ListDocumentsArgs {
  /**
   * Restrict the listing to the direct children of this folder document
   * (the folder's `documentId`). The progressive index collapses folders and
   * surfaces this id so the model can expand a folder on demand.
   */
  parentId?: string;
  scope?: 'agent' | 'currentTopic';
  sourceType?: 'all' | 'file' | 'web';
}

export interface ListDocumentsState {
  documents: { documentId?: string; filename: string; id: string; title?: string }[];
}
