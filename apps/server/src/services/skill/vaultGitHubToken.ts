import type { CredWithPlaintext, UserCredSummary } from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-chat:service:skill-vault-github-token');

/** Value names read as a GitHub token, in order of preference. */
export const GITHUB_TOKEN_NAMES = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT', 'GITHUB_ACCESS_TOKEN'];

/** Prefixes GitHub gives its tokens (classic, fine-grained, OAuth, app user, app server). */
const GITHUB_TOKEN_PREFIX = /^(?:ghp_|github_pat_|gho_|ghu_|ghs_)/;

/** At most this many credentials are decrypted while looking for the token. */
const MAX_DECRYPTS = 5;

export interface VaultCredsReader {
  get: (id: number, options: { decrypt: boolean }) => Promise<Partial<CredWithPlaintext>>;
  list: () => Promise<{ data?: UserCredSummary[] }>;
}

const namesGitHub = (cred: UserCredSummary) =>
  /github/i.test(cred.key) || /github/i.test(cred.name) || /^gh(?:[-_]?token)?$/i.test(cred.key);

/**
 * Rank a KV credential as a GitHub token holder: key `github` first, then a key
 * or name mentioning GitHub, then any whose masked value has a GitHub prefix.
 */
const rank = (cred: UserCredSummary) => {
  if (cred.type !== 'kv-env' && cred.type !== 'kv-header') return 0;
  if (cred.key.toLowerCase() === 'github') return 3;
  if (namesGitHub(cred)) return 2;
  if (cred.maskedPreview && GITHUB_TOKEN_PREFIX.test(cred.maskedPreview)) return 1;
  return 0;
};

/** The token in a decrypted credential, by value name, else its only value. */
export const tokenFrom = (cred: UserCredSummary, plaintext?: Record<string, string>) => {
  if (!plaintext) return;
  const entries = Object.entries(plaintext);
  const byName = new Map(entries.map(([name, value]) => [name.toUpperCase(), value?.trim()]));
  for (const name of GITHUB_TOKEN_NAMES) {
    const value = byName.get(name);
    if (value) return value;
  }
  if (entries.length !== 1) return;
  const value = entries[0][1]?.trim();
  if (value && (GITHUB_TOKEN_PREFIX.test(value) || namesGitHub(cred))) return value;
};

/** The first GitHub token found among a Vault's KV credentials. */
export const findGitHubToken = async (reader: VaultCredsReader) => {
  const { data = [] } = await reader.list();
  const candidates = data
    .map((cred) => ({ cred, rank: rank(cred) }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_DECRYPTS);
  for (const { cred } of candidates) {
    try {
      const { plaintext } = await reader.get(cred.id, { decrypt: true });
      const token = tokenFrom(cred, plaintext);
      if (token) {
        log('using Vault credential key=%s', cred.key);
        return token;
      }
    } catch (error) {
      log('could not read Vault credential key=%s: %s', cred.key, (error as Error).message);
    }
  }
};

/**
 * The caller's GitHub token from their Vault: personal credentials first, then
 * (in a workspace) the workspace's own credentials that are not kept private.
 * A Vault that cannot be read is treated as holding no token.
 */
export const resolveVaultGitHubToken = async (readers: VaultCredsReader[]) => {
  for (const reader of readers) {
    try {
      const token = await findGitHubToken(reader);
      if (token) return token;
    } catch (error) {
      log('could not list Vault credentials: %s', (error as Error).message);
    }
  }
};

/** Keep only credentials a workspace owns and shares with every member. */
export const workspaceOwned = (reader: VaultCredsReader): VaultCredsReader => ({
  get: (id, options) => reader.get(id, options),
  list: async () => {
    const { data = [] } = await reader.list();
    return {
      data: data.filter(
        (cred) => cred.ownerType === 'organization' && cred.visibility !== 'private',
      ),
    };
  },
});
