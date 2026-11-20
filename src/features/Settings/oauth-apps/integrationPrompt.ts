import { type IntegrationEndpoint, type IntegrationEndpointKey } from './integrationEndpoints';

/**
 * The one-prompt integration: a ready-to-paste instruction for a coding agent
 * (Claude Code, Codex, …) that wires LobeHub sign-in into the user's project.
 * The template is per flow; the values are this app's real credentials and
 * endpoints, so the pasted prompt works without editing.
 */
export const integrationPromptKey = (applicationType?: string | null) =>
  applicationType === 'web'
    ? ('oauthApp.integration.prompt.web' as const)
    : ('oauthApp.integration.prompt.device' as const);

export const integrationPromptValues = (
  endpoints: IntegrationEndpoint[],
  app: { clientId: string; name: string },
): { appName: string; clientId: string } & Partial<Record<IntegrationEndpointKey, string>> => ({
  appName: app.name,
  clientId: app.clientId,
  ...Object.fromEntries(endpoints.map(({ key, url }) => [key, url])),
});
