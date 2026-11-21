/** The search param naming the open tab of the Environments & Vault page. */
export const TAB_PARAM = 'tab';

export const PAGE_TABS = ['environments', 'vault'] as const;

export type PageTab = (typeof PAGE_TABS)[number];

/**
 * Opens the vault tab of the workspace Environments & Vault page. Old
 * workspace credential links (`/:slug/settings/credential`) land on it; the
 * personal vault has its own settings entry instead.
 */
export const VAULT_TAB_SEARCH = `?${TAB_PARAM}=vault`;
