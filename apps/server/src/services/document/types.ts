import type { DocumentWriteSource } from '@lobechat/types';

import type { LobeChatDatabase, Transaction } from '@/database/type';

export type DocumentHistorySaveSource = 'autosave' | 'manual' | 'restore' | 'system' | 'llm_call';

export interface CompareDocumentHistoryItemsParams {
  documentId: string;
  fromHistoryId: string;
  toHistoryId: string;
}

export interface CompareDocumentHistoryItemsResult {
  from: DocumentHistoryItemResult;
  to: DocumentHistoryItemResult;
}

export interface DocumentHistoryAccessOptions {
  historySince?: Date;
}

export interface DocumentHistoryListItem {
  /** Agent that produced an `llm_call` version. */
  agentId?: string | null;
  /** Everyone whose edits this version records; absent on versions saved before attribution. */
  editorIds?: string[] | null;
  id: string;
  isCurrent: boolean;
  savedAt: Date;
  saveSource: DocumentHistorySaveSource;
  userId: string;
}

/** Who a saved version is attributed to. */
export interface DocumentHistoryAttribution {
  agentId?: string;
  editorIds?: string[];
  /** Agent run behind an `llm_call` version; a run keeps a single version. */
  operationId?: string;
}

export interface DocumentHistoryItemResult {
  editorData: Record<string, any> | null;
  id: string;
  isCurrent: boolean;
  savedAt: Date;
  saveSource: DocumentHistorySaveSource;
}

export interface GetDocumentHistoryItemParams {
  documentId: string;
  historyId: string;
}

export interface ListDocumentHistoryParams {
  beforeId?: string;
  beforeSavedAt?: Date;
  documentId: string;
  includeCurrent?: boolean;
  limit?: number;
}

export interface ListDocumentHistoryResult {
  items: DocumentHistoryListItem[];
  nextBeforeId?: string;
  nextBeforeSavedAt?: Date;
}

export type DatabaseLike = LobeChatDatabase | Transaction;

export interface UpdateDocumentParams {
  breakAutosaveWindow?: boolean;
  content?: string;
  editorData?: Record<string, any>;
  /** See `updateDocumentInputSchema.expectedUpdatedAt` — atomic version predicate. */
  expectedUpdatedAt?: Date;
  fileType?: string;
  /** Attribution for the history version this save may append. */
  history?: DocumentHistoryAttribution;
  lockOwnerId?: string;
  metadata?: Record<string, any>;
  /**
   * `room-projection`: the page's live collaboration room persisting its state.
   * The CRDT already merged concurrent edits, so the edit lock does not apply,
   * and the body is written as is instead of being routed back into the room.
   */
  origin?: 'room-projection';
  parentId?: string | null;
  restoreFromHistoryId?: string;
  saveSource?: DocumentHistorySaveSource;
  title?: string;
  /**
   * Who asked for the write; decides whether the per-document character limit
   * applies. Defaults to `user`. Restores, rollbacks and other writes the user
   * did not type pass `system`.
   */
  writeSource?: DocumentWriteSource;
}

export interface UpdateDocumentResult {
  /**
   * Workspace member ids @-mentioned in the saved body that were absent from
   * the previous snapshot. Present only when this save added at least one.
   */
  addedMentionUserIds?: string[];
  historyAppended: boolean;
  id: string;
  savedAt?: Date;
  updatedAt: Date;
}

export interface SaveDocumentHistoryResult {
  historyId: string;
  savedAt: Date;
}

export interface DocumentLockResult {
  /** Lease expiry of the active lock, if any. */
  expiresAt: Date | null;
  /** The user id currently holding the lock, or null when unlocked. */
  holderId: string | null;
  /** True when another active user holds the lock (caller is locked out). */
  lockedByOther: boolean;
  /** The edit-session id currently holding the lock, or null when unlocked / legacy. */
  ownerId: string | null;
}
