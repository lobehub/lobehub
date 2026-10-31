import * as stylex from '@stylexjs/stylex';

/**
 * Hover / focus markers for StyleX `when.ancestor()` rules. Each is unique, so a
 * hovered outer element never triggers a descendant rule meant for another one.
 */
export const groupHeaderMarker = stylex.defineMarker();
export const rowHeaderMarker = stylex.defineMarker();
export const timelineEntryMarker = stylex.defineMarker();
export const roundHeaderMarker = stylex.defineMarker();
export const floatingActionHostMarker = stylex.defineMarker();
export const goalCardMarker = stylex.defineMarker();
export const titleRowMarker = stylex.defineMarker();
export const roundCardMarker = stylex.defineMarker();
