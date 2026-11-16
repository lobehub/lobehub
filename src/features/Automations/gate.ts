export type AutomationsGate = 'loading' | 'notFound' | 'ready';

/**
 * Whether the automations page can show: behind the `webhook` flag like
 * its sidebar entry, so a deep link while the feature is off is a 404 rather
 * than an empty list; and not before the server config has loaded, or the
 * flag would read as off for a moment and flash the 404.
 */
export const resolveAutomationsGate = ({
  enableWebhook,
  serverConfigInit,
}: {
  enableWebhook: boolean;
  serverConfigInit: boolean;
}): AutomationsGate => {
  if (!serverConfigInit) return 'loading';
  return enableWebhook ? 'ready' : 'notFound';
};
