import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { createElement } from 'react';

import { BillingSourceSwitcher } from '@/features/AicoBilling';

export const useBusinessChatInputCostEstimateAlert = (): ReactNode => null;

export const useBusinessChatInputAlerts = (): ReactNode => null;

/**
 * Aico billing source switcher sits next to the send area so users can pick
 * personal vs org credit (separate balances) while chatting.
 *
 * Conversation ChatInput injects this automatically. Home and other surfaces
 * that render DesktopChatInput directly must pass
 * `sendAreaPrefix={getBusinessChatInputSendAreaPrefix()}` so the wallet can be
 * chosen before the first message.
 */
export const getBusinessChatInputSendAreaPrefix = (sendAreaPrefix?: ReactNode): ReactNode => {
  const switcher = createElement(BillingSourceSwitcher);
  if (!sendAreaPrefix) return switcher;

  return createElement(
    Flexbox,
    { align: 'center', gap: 6, horizontal: true },
    switcher,
    sendAreaPrefix,
  );
};

export const useBusinessChatInputSendAreaPrefix = getBusinessChatInputSendAreaPrefix;
