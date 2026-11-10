export const AgentDocumentsIdentifier = 'lobe-agent-documents';

/**
 * Upper bound on the characters a single readDocument result feeds back into the
 * model context. Agent documents can hold whole email/newsletter archives that
 * run into the millions of characters; returning one whole once pushed a task
 * past the model's context window — a lone tool result reached ~591k tokens and
 * the next completion 400'd with ExceededContextWindow. The client Inspector
 * still renders the full document from `state`, so only the LLM-facing `content`
 * is capped. ~200k chars is roughly 50k tokens per field — generous for a real
 * document read while leaving ample room in the window.
 */
export const MAX_READ_DOCUMENT_CONTENT_CHARS = 200_000;

export const AgentDocumentsApiName = {
  createDocument: 'createDocument',
  createFolder: 'createFolder',
  copyDocument: 'copyDocument',
  listDocuments: 'listDocuments',
  modifyNodes: 'modifyNodes',
  moveDocuments: 'moveDocuments',
  readDocument: 'readDocument',
  removeDocument: 'removeDocument',
  renameDocument: 'renameDocument',
  replaceDocumentContent: 'replaceDocumentContent',
  updateLoadRule: 'updateLoadRule',
} as const;

/**
 * Document APIs a shared-agent visitor may use after the owner grants this tool.
 * The server still scopes every call to the exact share, visitor, and topic.
 */
export const AGENT_SHARE_DOCUMENT_API_NAMES = new Set<string>([
  AgentDocumentsApiName.createDocument,
  AgentDocumentsApiName.listDocuments,
  AgentDocumentsApiName.modifyNodes,
  AgentDocumentsApiName.readDocument,
  AgentDocumentsApiName.renameDocument,
  AgentDocumentsApiName.replaceDocumentContent,
]);

export interface CreateDocumentArgs {
  content: string;
  hintIsSkill?: boolean;
  /** Parent folder or document — its `documentId` (or `id`) from listDocuments. */
  parentId?: string;
  scope?: 'agent' | 'currentTopic';
  title: string;
}

export interface CreateDocumentState {
  agentDocumentId?: string;
  /** Owning agent id — used to attribute the created document's Work. */
  agentId?: string;
  documentId?: string;
  /** The caller may preview/copy this result but must not open the owner-only editor. */
  readonly?: boolean;
}

export interface ReadDocumentArgs {
  format?: 'xml' | 'markdown' | 'both';
  id: string;
  /** Maximum number of lines to return. */
  limit?: number;
  /** 1-based line to start reading from. */
  offset?: number;
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
  /** Also delete everything nested under it. Without it, a parent with children is refused. */
  withChildren?: boolean;
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
  /** Page size; defaults to {@link LIST_DOCUMENTS_DEFAULT_LIMIT}. */
  limit?: number;
  /** Number of documents to skip, for paging past the first page. */
  offset?: number;
  /**
   * Restrict the listing to the direct children of this parent — a folder or a
   * document. Either id works; the progressive index surfaces its `documentId`.
   */
  parentId?: string;
  scope?: 'agent' | 'currentTopic';
  sourceType?: 'all' | 'file' | 'web';
  /** Case-insensitive substring filter on the title, applied before paging. */
  titleContains?: string;
}

export interface CreateFolderArgs {
  /** Parent folder or document (either id); omit to create at the root. */
  parentId?: string;
  title: string;
}

export interface CreateFolderState {
  agentDocumentId?: string;
  agentId?: string;
  /** False when a folder with this name already existed and was reused. */
  created: boolean;
  documentId?: string;
  title: string;
}

/** Upper bound on ids per moveDocuments call. */
export const MOVE_DOCUMENTS_MAX_IDS = 200;

export interface MoveDocumentsArgs {
  /** Documents or folders to move; either id of each works. */
  ids: string[];
  /** Destination folder or document (either id), or null to move to the root. */
  parentId: string | null;
}

export interface MoveDocumentResultItem {
  documentId?: string;
  error?: string;
  id: string;
  status: 'failed' | 'moved' | 'unchanged';
  title?: string;
}

export interface MoveDocumentsState {
  agentId?: string;
  failedCount: number;
  movedCount: number;
  parentId: string | null;
  results: MoveDocumentResultItem[];
}

/**
 * An agent can own thousands of documents (mostly web-crawled pages); listing
 * them all in one result blew past the model's context window.
 */
export const LIST_DOCUMENTS_DEFAULT_LIMIT = 50;
export const LIST_DOCUMENTS_MAX_LIMIT = 200;

export interface ListDocumentsState {
  /**
   * How many rows `documents` held, pinned by the read-path projector before it
   * drops them. The inspector chip is the only surface that reads this state,
   * and a count is all it shows.
   */
  documentCount?: number;
  documents: ListedAgentDocument[];
}

export interface ListedAgentDocument {
  /** Entries nested directly under this one; documents can hold children too. */
  childCount?: number;
  documentId?: string;
  filename: string;
  id: string;
  /** `documentId` of the folder or document this entry sits under; null at the root. */
  parentId?: string | null;
  title?: string;
  type?: 'file' | 'folder';
  /** ISO timestamp of the last change. */
  updatedAt?: string;
}
