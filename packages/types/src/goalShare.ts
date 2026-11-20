/**
 * Owner-controlled settings for a goal share link (which parts of the goal the page shows, etc.).
 * Stored as jsonb, so adding a control needs no migration; unset keys fall back to defaults.
 */
export type GoalShareConfig = Record<string, unknown>;
