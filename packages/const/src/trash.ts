/**
 * How long a trashed item stays restorable before the purge sweep hard-deletes
 * it. Mirrors the retention most desktop / cloud recycle bins use, long enough
 * that a Monday "where did my chat go" still finds last month's cleanup.
 */
export const TRASH_RETENTION_DAYS = 30;

export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Page size the recycle bin UI asks for; keeps the first paint cheap. */
export const TRASH_LIST_PAGE_SIZE = 50;

/** Maximum number of resource ids accepted by one trash mutation request. */
export const TRASH_MUTATION_BATCH_SIZE = 200;

/** Roots the purge sweep hard-deletes per invocation. Bounded so one cron tick never runs away. */
export const TRASH_PURGE_BATCH_SIZE = 200;
