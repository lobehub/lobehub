import type { CredType } from '@lobechat/types';

/**
 * Summary of a user credential for display in the tool prompt
 */
export interface CredSummary {
  description?: string;
  key: string;
  name: string;
  /**
   * Only populated when the list comes from a workspace's merged
   * organization-scoped view (org-owned creds + members' shared creds):
   * 'organization' for a credential the workspace created directly, 'user'
   * for one a member shared in. The AI needs this to tell the user whose
   * credential it's actually using — never silently treat a member's shared
   * key as if the workspace owns it. Absent entirely for a personal-only list.
   */
  ownerDisplayName?: string;
  ownerType?: 'organization' | 'user';
  type: CredType;
}

/**
 * Context for injecting creds data into the tool content
 */
export interface UserCredsContext {
  creds: CredSummary[];
  settingsUrl: string;
}

/**
 * Group credentials by type for better organization
 */
export const groupCredsByType = (creds: CredSummary[]): Record<CredType, CredSummary[]> => {
  const groups: Record<CredType, CredSummary[]> = {
    'file': [],
    'kv-env': [],
    'kv-header': [],
    'oauth': [],
  };

  for (const cred of creds) {
    groups[cred.type].push(cred);
  }

  return groups;
};

/**
 * Format a single credential for display
 */
const formatCred = (cred: CredSummary): string => {
  const desc = cred.description ? ` - ${cred.description}` : '';
  const ownership =
    cred.ownerType === 'user'
      ? ` [shared by ${cred.ownerDisplayName ?? 'a workspace member'}]`
      : cred.ownerType === 'organization'
        ? ' [workspace credential]'
        : '';
  return `  - ${cred.name} (key: ${cred.key})${desc}${ownership}`;
};

/**
 * Generate the creds list string for injection into the prompt
 */
export const generateCredsList = (creds: CredSummary[]): string => {
  if (creds.length === 0) {
    return 'No credentials configured yet. Guide the user to set up credentials when needed.';
  }

  const groups = groupCredsByType(creds);
  const sections: string[] = [];

  if (groups['kv-env'].length > 0) {
    sections.push(`**Environment Variables:**\n${groups['kv-env'].map(formatCred).join('\n')}`);
  }

  if (groups['kv-header'].length > 0) {
    sections.push(`**HTTP Headers:**\n${groups['kv-header'].map(formatCred).join('\n')}`);
  }

  if (groups['oauth'].length > 0) {
    sections.push(`**OAuth Connections:**\n${groups['oauth'].map(formatCred).join('\n')}`);
  }

  if (groups['file'].length > 0) {
    sections.push(`**File Credentials:**\n${groups['file'].map(formatCred).join('\n')}`);
  }

  return sections.join('\n\n');
};

/**
 * Inject user creds context into the tool content
 * This replaces {{CREDS_LIST}} and {{SETTINGS_URL}} placeholders
 */
export const injectCredsContext = (content: string, context: UserCredsContext): string => {
  const credsList = generateCredsList(context.creds);

  return content
    .replaceAll('{{CREDS_LIST}}', credsList)
    .replaceAll('{{SETTINGS_URL}}', context.settingsUrl);
};

// ==================== Composio Services ====================

/**
 * Summary of a Composio service for display in the tool prompt
 */
export interface ComposioServiceSummary {
  description?: string;
  identifier: string;
  name: string;
}

export interface ComposioAppTypeLike {
  identifier: string;
  label: string;
}

/**
 * Drops services the agent has disabled (tri-state `agents.plugins`) from a
 * Composio service list. Shared by both the client (contextEngineering.ts)
 * and server (callLlm.ts) prompt-building paths so a disabled integration
 * never surfaces as "connected — use tools directly" in either one.
 */
export const excludeDisabledComposioServices = <T extends { identifier: string }>(
  services: T[],
  disabledIds: Set<string>,
): T[] => services.filter((s) => !disabledIds.has(s.identifier));

/**
 * Builds the "available to connect" list: every known Composio app type
 * that's neither already connected nor disabled for this agent. The client
 * and server paths compute this identically off the static
 * `COMPOSIO_APP_TYPES` catalog, so it's extracted once here.
 */
export const resolveAvailableComposioServices = (
  appTypes: ComposioAppTypeLike[],
  connectedIds: Set<string>,
  disabledIds: Set<string>,
): ComposioServiceSummary[] =>
  appTypes
    .filter((t) => !connectedIds.has(t.identifier) && !disabledIds.has(t.identifier))
    .map((t) => ({ identifier: t.identifier, name: t.label }));

/**
 * Generate the Composio services list string for injection into the prompt
 */
export const generateComposioServicesList = (
  connected: ComposioServiceSummary[],
  available: ComposioServiceSummary[],
): string => {
  if (connected.length === 0 && available.length === 0) {
    return '';
  }

  const sections: string[] = [];

  if (connected.length > 0) {
    const items = connected
      .map(
        (s) =>
          `  - ${s.name} (identifier: ${s.identifier}) — Authorized via Composio OAuth. Use ${s.identifier} tools directly.`,
      )
      .join('\n');
    sections.push(`**Connected Composio Services (authorized, use tools directly):**\n${items}`);
  }

  if (available.length > 0) {
    const items = available
      .map(
        (s) =>
          `  - ${s.name} (identifier: ${s.identifier}) — Use \`connectComposioService\` to connect.`,
      )
      .join('\n');
    sections.push(`**Available Composio Services (not yet connected):**\n${items}`);
  }

  return sections.join('\n\n');
};

/**
 * Check if a skill's required credentials are satisfied
 */
export interface CredRequirement {
  key: string;
  name: string;
  type: CredType;
}

export const checkCredsSatisfied = (
  requirements: CredRequirement[],
  availableCreds: CredSummary[],
): { missing: CredRequirement[]; satisfied: boolean } => {
  const availableKeys = new Set(availableCreds.map((c) => c.key));
  const missing = requirements.filter((req) => !availableKeys.has(req.key));

  return {
    missing,
    satisfied: missing.length === 0,
  };
};
