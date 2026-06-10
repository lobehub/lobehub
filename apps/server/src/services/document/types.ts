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
  id: string;
  isCurrent: boolean;
  savedAt: Date;
  saveSource: DocumentHistorySaveSource;
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
  content?: string;
  editorData?: Record<string, any>;
  fileType?: string;
  metadata?: Record<string, any>;
  parentId?: string | null;
  restoreFromHistoryId?: string;
  saveSource?: DocumentHistorySaveSource;
  title?: string;
}

export interface UpdateDocumentResult {
  historyAppended: boolean;
  id: string;
  savedAt?: Date;
}

export interface SaveDocumentHistoryResult {
  savedAt: Date;
}
