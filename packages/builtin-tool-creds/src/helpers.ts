import type { CredType } from '@lobechat/types';

/**
 * Summary of a user credential for display in the tool prompt
 */
export interface CredSummary {
  description?: string;
  key: string;
  name: string;
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
  return `  - ${cred.name} (key: ${cred.key})${desc}`;
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
