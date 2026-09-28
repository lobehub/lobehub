import { createContext, useContext } from 'react';

/**
 * Whether the loading indicator may tell the user a server-side run keeps going
 * after they leave the page. Surfaces where that reassurance means nothing to
 * the reader (e.g. an external visitor view) turn it off via `ChatList`.
 */
export const BackgroundRunHintContext = createContext(true);

export const useShowBackgroundRunHint = () => useContext(BackgroundRunHintContext);
