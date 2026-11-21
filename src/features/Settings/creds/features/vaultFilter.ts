import { type CredType, type UserCredSummary } from '@lobechat/types';

/** The vault's category tabs: every type, preceded by "All". */
export const VAULT_CATEGORIES = ['all', 'kv-env', 'kv-header', 'oauth', 'file'] as const;

export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

/** Every text a person may remember an item by. */
const searchableFields = (cred: UserCredSummary) => [
  cred.name,
  cred.key,
  cred.description,
  cred.oauthProvider,
  cred.oauthUsername,
  cred.fileName,
];

export const matchesVaultKeyword = (cred: UserCredSummary, keyword: string) => {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return searchableFields(cred).some((field) => field?.toLowerCase().includes(needle));
};

/**
 * Narrows the vault by search keyword and category. The category counts are
 * taken after the keyword, so each tab tells how many results it would show.
 */
export const filterVault = (
  creds: UserCredSummary[],
  { category, keyword }: { category: VaultCategory; keyword: string },
) => {
  const matched = creds.filter((cred) => matchesVaultKeyword(cred, keyword));

  const counts = Object.fromEntries(VAULT_CATEGORIES.map((c) => [c, 0])) as Record<
    VaultCategory,
    number
  >;
  counts.all = matched.length;
  for (const cred of matched) {
    if (cred.type in counts) counts[cred.type as CredType] += 1;
  }

  const items = category === 'all' ? matched : matched.filter((cred) => cred.type === category);

  return { counts, items };
};
