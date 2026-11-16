export type AutomationsGate = 'loading' | 'notFound' | 'ready';

/**
 * Whether the automations page can show: behind the `mcp_events` or
 * `agent_webhooks` flag like its sidebar entry, so a deep link while the feature is off is a 404 rather
 * than an empty list; and not before the server config has loaded, or the
 * flag would read as off for a moment and flash the 404.
 */
export const resolveAutomationsGate = ({
  enableAgentWebhooks = false,
  enableMcpEvents,
  serverConfigInit,
}: {
  enableAgentWebhooks?: boolean;
  enableMcpEvents: boolean;
  serverConfigInit: boolean;
}): AutomationsGate => {
  if (!serverConfigInit) return 'loading';
  return enableMcpEvents || enableAgentWebhooks ? 'ready' : 'notFound';
};
