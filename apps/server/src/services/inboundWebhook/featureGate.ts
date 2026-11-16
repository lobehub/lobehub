import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Whether inbound webhooks wake this user's Agents (runtime flag `webhook`, off by default).
 * Off: deliveries are still verified, recorded and acknowledged, but run nothing.
 *
 * An unreadable flag counts as off.
 */
export const isWebhookEnabled = async (userId?: string | null): Promise<boolean> => {
  try {
    return (
      (await getServerFeatureFlagsStateFromRuntimeConfig(userId ?? undefined)).enableWebhook ===
      true
    );
  } catch (error) {
    console.error('[inboundWebhook] Failed to read the webhook feature flag:', error);
    return false;
  }
};
