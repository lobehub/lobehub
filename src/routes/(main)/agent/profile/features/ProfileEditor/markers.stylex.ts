import * as stylex from '@stylexjs/stylex';

/** Marks each detail row, so a row can tell whether another row precedes it. */
export const detailRowMarker = stylex.defineMarker();

/** Hover host revealing the command edit button. */
export const commandFieldMarker = stylex.defineMarker();

/** Hover host revealing a repository row's delete button. */
export const repoItemMarker = stylex.defineMarker();
