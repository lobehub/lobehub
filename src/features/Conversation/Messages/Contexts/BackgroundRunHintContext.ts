import { createContext, useContext } from 'react';

import { type OperationType } from '@/store/chat/slices/operation/types';

/**
 * Whether the loading indicator may tell the user a server-side run keeps going
 * after they leave the page. Surfaces where that reassurance means nothing to
 * the reader (e.g. an external visitor view) turn it off via `ChatList`.
 */
export const BackgroundRunHintContext = createContext(true);

export const useShowBackgroundRunHint = () => useContext(BackgroundRunHintContext);

/**
 * The server-run copy ("you can safely leave this page") is the only label the
 * switch suppresses; the caller then falls back to the plain dot loader.
 */
export const isHiddenBackgroundRunLabel = (
  operationType: OperationType,
  showBackgroundRunHint: boolean,
) => operationType === 'execServerAgentRuntime' && !showBackgroundRunHint;
