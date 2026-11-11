/**
 * Whether a key press should open a clickable row: Enter or Space, and only when the row itself
 * has focus — a press on a switch or button inside the row belongs to that control.
 */
export const shouldActivateRow = (event: {
  currentTarget: unknown;
  key: string;
  target: unknown;
}): boolean => event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ');
