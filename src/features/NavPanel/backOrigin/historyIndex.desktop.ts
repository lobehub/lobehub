/**
 * Desktop tabs keep their own histories outside `window.history`, so the back
 * button always navigates to the origin there.
 */
export const readHistoryIndex = (): number | undefined => undefined;
