'use client';

import {
  type AicoBillingChatBlockReason,
  canChatWithBillingSource,
  getBillingChatBlockReason,
} from './types';
import { useAicoBillingSources } from './useAicoBillingSources';

export type AicoBillingChatGate = {
  blocked: boolean;
  blockReason: AicoBillingChatBlockReason | null;
  showTrialCta: boolean;
  trialActive: boolean;
  trialAvailable: boolean;
};

export const useAicoBillingChatGate = (): AicoBillingChatGate => {
  const { activeSource, data, isLoading } = useAicoBillingSources();

  if (isLoading || !data || !activeSource) {
    return {
      blocked: true,
      blockReason: null,
      showTrialCta: false,
      trialActive: Boolean(data?.trialActive),
      trialAvailable: Boolean(data?.trialAvailable),
    };
  }

  const trialActive = Boolean(data.trialActive);
  const trialAvailable = Boolean(data.trialAvailable);
  const blockReason = getBillingChatBlockReason(activeSource, { trialActive });
  const blocked = !canChatWithBillingSource(activeSource, { trialActive });

  return {
    blocked,
    blockReason,
    showTrialCta:
      blocked &&
      activeSource.source === 'personal' &&
      trialAvailable &&
      (blockReason === 'PERSONAL_FUNDS_UNAVAILABLE' || blockReason === 'MANAGED_KEY_UNAVAILABLE'),
    trialActive,
    trialAvailable,
  };
};
