export type AutomationsGate = 'loading' | 'notFound' | 'ready';

/**
 * Whether the automations page can show: behind the `mcp_events` flag like
 * its sidebar entry, so a deep link while the feature is off is a 404 rather
 * than an empty list; and not before the server config has loaded, or the
 * flag would read as off for a moment and flash the 404.
 */
export const resolveAutomationsGate = ({
  enableMcpEvents,
  serverConfigInit,
}: {
  enableMcpEvents: boolean;
  serverConfigInit: boolean;
}): AutomationsGate => {
  if (!serverConfigInit) return 'loading';
  return enableMcpEvents ? 'ready' : 'notFound';
};
