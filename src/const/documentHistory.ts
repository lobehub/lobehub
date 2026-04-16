import type { DocumentHistorySaveSource } from '@/server/services/document/types';

export const DOCUMENT_HISTORY_QUERY_LIST_LIMIT = 50;

export const FREE_DOCUMENT_HISTORY_WINDOW_DAYS = 30;

export const DOCUMENT_HISTORY_SOURCE_LIMITS: Record<DocumentHistorySaveSource, number> = {
  autosave: 20,
  manual: 20,
  restore: 5,
  system: 5,
  llm_call: 5,
};
