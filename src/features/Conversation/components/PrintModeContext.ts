import { createContext, useContext } from 'react';

/**
 * Whether the current subtree is the static copy that only exists for browser
 * printing (`PrintTranscript`).
 *
 * The print copy reuses the live row renderer so paper looks like the screen,
 * and it is mounted only between `beforeprint` and `afterprint`. Interactive
 * lifecycles must stay shut inside it: a second message-editing modal opens
 * against the same store flag as the real editor, and closing it when the copy
 * unmounts also closes the user's editor and discards the unsaved draft.
 */
export const PrintModeContext = createContext(false);

export const usePrintMode = () => useContext(PrintModeContext);
