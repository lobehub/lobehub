/**
 * Tooltip copy for a composer control the caller cannot change: the current
 * value first, then why it is locked.
 *
 * Shared by the model triggers and the execution-target chip so a locked
 * control never degrades into a bare label with no explanation.
 */
export const formatLockedControlTooltip = (label: string, reason: string) => `${label} · ${reason}`;
