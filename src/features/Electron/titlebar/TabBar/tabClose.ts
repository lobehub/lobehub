// A lone tab offers no close at all — button, middle-click or context menu. Closing it
// only swaps in a fresh home tab, so each would read as a way out that does not exist.
// The window-close shortcut keeps its own rules (see resolveCloseShortcut).
export const isTabClosable = (totalCount: number): boolean => totalCount > 1;
