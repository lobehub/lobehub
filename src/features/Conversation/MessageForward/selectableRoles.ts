/**
 * Roles that carry forwardable text. Tool calls, tasks, verify cards etc. are
 * not meaningful as standalone forwarded context, so they stay un-selectable.
 * Shared by the per-message checkbox and the "select to here" range action.
 */
export const SELECTABLE_ROLES = new Set(['user', 'assistant', 'assistantGroup']);

export const isSelectableRole = (role?: string): boolean => !!role && SELECTABLE_ROLES.has(role);
