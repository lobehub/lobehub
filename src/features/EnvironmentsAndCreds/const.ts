/** The search param naming the open tab of the Environments & Vault page. */
export const TAB_PARAM = 'tab';

export const PAGE_TABS = ['environments', 'vault'] as const;

export type PageTab = (typeof PAGE_TABS)[number];

/**
 * Opens the vault tab. Old credential links (`/settings/credential`) land on
 * the merged page with it.
 */
export const VAULT_TAB_SEARCH = `?${TAB_PARAM}=vault`;
