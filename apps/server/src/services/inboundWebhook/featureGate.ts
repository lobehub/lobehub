import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Whether generic inbound webhooks are on for this user (runtime flag `agent_webhooks`, off by
 * default). An unreadable flag counts as off, like the MCP flags.
 */
export const isAgentWebhooksEnabled = async (userId?: string | null): Promise<boolean> => {
  try {
    return (
      (await getServerFeatureFlagsStateFromRuntimeConfig(userId ?? undefined))
        .enableAgentWebhooks === true
    );
  } catch (error) {
    console.error('[AgentWebhooks] Failed to read the agent_webhooks feature flag:', error);
    return false;
  }
};
