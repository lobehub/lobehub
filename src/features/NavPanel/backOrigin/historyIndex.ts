/**
 * The react-router index of the current browser history entry, used to walk
 * back to an origin instead of pushing it again.
 */
export const readHistoryIndex = (): number | undefined => {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === 'number' ? index : undefined;
};
