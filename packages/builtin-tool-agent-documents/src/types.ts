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
  target?: 'agent' | 'currentTopic';
  title: string;
}

export interface CreateDocumentState {
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
  | ModifyDocumentInsertOperation
  | ModifyDocumentRemoveOperation
  | ModifyDocumentUpdateOperation;

export interface ModifyDocumentNodesArgs {
  id: string;
  operations: ModifyDocumentOperation[];
}

export interface ModifyDocumentNodesState {
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
  deleted: boolean;
  id: string;
}

export interface RenameDocumentArgs {
  id: string;
  newTitle: string;
}

export interface RenameDocumentState {
  id: string;
  newTitle: string;
  renamed: boolean;
}

export interface CopyDocumentArgs {
  id: string;
  newTitle?: string;
}

export interface CopyDocumentState {
  copiedFromId: string;
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
  target?: 'agent' | 'currentTopic';
}

export interface ListDocumentsState {
  documents: { documentId?: string; filename: string; id: string; title?: string }[];
}
