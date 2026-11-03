/**
 * Resolve an agent id from the notification's existing deep link. Supports
 * both personal `/agent/:id` paths and workspace-prefixed `/:slug/agent/:id`
 * paths without inventing an Agent association for unrelated notifications.
 */
export const getNotificationAgentId = (actionUrl?: string | null): string | undefined => {
  if (!actionUrl) return undefined;

  try {
    const { pathname } = new URL(actionUrl, 'https://notification.local');
    const segments = pathname.split('/').filter(Boolean);
    const agentSegmentIndex = segments[1] === 'agent' ? 1 : segments[0] === 'agent' ? 0 : -1;
    if (agentSegmentIndex < 0) return undefined;

    const encodedAgentId = segments[agentSegmentIndex + 1];

    return encodedAgentId ? decodeURIComponent(encodedAgentId) : undefined;
  } catch {
    return undefined;
  }
};
