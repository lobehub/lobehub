export const AgentDocumentsIdentifier = 'lobe-agent-documents';

export const AgentDocumentsApiName = {
  createDocument: 'createDocument',
  copyDocument: 'copyDocument',
  editDocument: 'editDocument',
  listDocuments: 'listDocuments',
  readDocument: 'readDocument',
  readDocumentByFilename: 'readDocumentByFilename',
  removeDocument: 'removeDocument',
  renameDocument: 'renameDocument',
  updateLoadRule: 'updateLoadRule',
  upsertDocumentByFilename: 'upsertDocumentByFilename',
} as const;

export interface CreateDocumentArgs {
  content: string;
  title: string;
}

export interface CreateDocumentState {
  documentId?: string;
}

export interface ReadDocumentArgs {
  id: string;
}

export interface ReadDocumentState {
  content?: string;
  id: string;
  title?: string;
}

export interface EditDocumentArgs {
  content: string;
  id: string;
}

export interface EditDocumentState {
  id: string;
  updated: boolean;
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

export interface ListDocumentsArgs {}

export interface ListDocumentsState {
  documents: { filename: string; id: string; title?: string }[];
}

export interface ReadDocumentByFilenameArgs {
  filename: string;
}

export interface ReadDocumentByFilenameState {
  content?: string;
  filename: string;
  id: string;
  title?: string;
}

export interface UpsertDocumentByFilenameArgs {
  content: string;
  filename: string;
}

export interface UpsertDocumentByFilenameState {
  created: boolean;
  filename: string;
  id: string;
}
