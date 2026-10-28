/**
 * Owner-controlled settings for a file share link (e.g. whether the page offers a download).
 * Stored as jsonb, so adding a control needs no migration; unset keys fall back to defaults.
 */
export type FileShareConfig = Record<string, unknown>;
