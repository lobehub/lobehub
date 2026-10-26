import { cssVar } from '@lobehub/ui';

// Kept dependency-free: the boot skeleton (entry chunk) mirrors these.

/** Icon rail width; the list column and content sit in the wrap to its right. */
export const RAIL_WIDTH = 52;

/**
 * The list column sits inside the wrap: a half step between the window
 * background (rail) and the content surface, like Codex's middle column.
 */
export const LIST_COLUMN_BACKGROUND = `color-mix(in srgb, ${cssVar.colorBgContainer} 55%, ${cssVar.colorBgLayout})`;
