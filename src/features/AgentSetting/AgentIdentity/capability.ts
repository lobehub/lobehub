import type { AgentAccountCapabilities } from '@lobechat/types';

export type CapabilityLabelKey =
  'identity.capability.receive' | 'identity.capability.send' | 'identity.capability.sendBlocked';

export type SendBlockedExplanationKey =
  'identity.capability.sendBlocked.campaign' | 'identity.capability.sendBlocked.generic';

export interface AccountCapabilityView {
  /** Chips to render, in order; `warning` marks a capability that is not open yet. */
  labels: { key: CapabilityLabelKey; tone: 'success' | 'warning' }[];
  /** Why sending is closed, when it is — shown instead of the display name. */
  sendBlockedKey?: SendBlockedExplanationKey;
}

/**
 * What an account can do, as the identity tab states it. A number that can
 * only receive must say so — and why — rather than look like a working phone.
 */
export const describeAccountCapability = (account: {
  capabilities: AgentAccountCapabilities;
  metadata?: Record<string, unknown> | null;
}): AccountCapabilityView => {
  const labels: AccountCapabilityView['labels'] = [];
  if (account.capabilities.receive) {
    labels.push({ key: 'identity.capability.receive', tone: 'success' });
  }

  if (account.capabilities.send) {
    labels.push({ key: 'identity.capability.send', tone: 'success' });
    return { labels };
  }

  labels.push({ key: 'identity.capability.sendBlocked', tone: 'warning' });
  return {
    labels,
    sendBlockedKey:
      account.metadata?.sendBlockedReason === 'messaging_campaign_not_approved'
        ? 'identity.capability.sendBlocked.campaign'
        : 'identity.capability.sendBlocked.generic',
  };
};
