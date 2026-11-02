/** Maximum number of Document History rows returned by one list request. */
export const DOCUMENT_HISTORY_QUERY_LIST_LIMIT = 50;

/** Number of days of Document History exposed to free-plan users. */
export const FREE_DOCUMENT_HISTORY_WINDOW_DAYS = 30;

/** Fixed clock window used to coalesce continuous editor autosaves into one history revision. */
export const DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS = 10 * 60 * 1000;

/** Retention limits for each Document History source. */
export const DOCUMENT_HISTORY_SOURCE_LIMITS = {
  autosave: 20,
  llm_call: 5,
  manual: 20,
  restore: 5,
  system: 5,
} as const;

/** Maximum number of retained autosave revisions for one Document. */
export const DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT = DOCUMENT_HISTORY_SOURCE_LIMITS.autosave;
