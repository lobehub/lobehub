/** What the edit form knew about the connector's OAuth setup when it opened. */
export interface OAuthBaseline {
  /** OAuth accounts connected now. */
  accountCount: number;
  /** Auth type the stored connector uses (`oauth2`, `bearer`, `none`, …). */
  authType?: string;
  /**
   * The hand-registered client id. A client the server resolved (DCR / CIMD)
   * is never shown in the form, so it stays `undefined` here as well.
   */
  clientId?: string;
  mcpServerUrl?: string | null;
}

/** The OAuth-relevant fields of the form as they would be saved. */
export interface OAuthFormFields {
  clientId?: string;
  clientSecret?: string;
  url?: string;
}

const normalize = (value?: string | null) => value?.trim() || undefined;

export const isServerUrlChanged = (baseline: OAuthBaseline, fields: OAuthFormFields): boolean =>
  normalize(fields.url) !== normalize(baseline.mcpServerUrl);

/** A different client id: the server then drops every connected account. */
export const isOAuthClientIdChanged = (baseline: OAuthBaseline, fields: OAuthFormFields): boolean =>
  normalize(fields.clientId) !== normalize(baseline.clientId);

/**
 * The OAuth client the form would save differs from the stored one: switching
 * to OAuth, another client id, or a newly typed secret (the stored secret is
 * never sent to the browser, so an empty field means "keep it").
 */
export const isOAuthClientChanged = (baseline: OAuthBaseline, fields: OAuthFormFields): boolean =>
  baseline.authType !== 'oauth2' ||
  isOAuthClientIdChanged(baseline, fields) ||
  !!normalize(fields.clientSecret);

/**
 * Whether saving an OAuth connector must take the user through authorization:
 * a new connector, a new server URL or OAuth client, or a connector with no
 * account yet. Any other edit (headers, description) saves in place and keeps
 * the connected accounts; re-authorizing one is on its row under Accounts.
 */
export const requiresOAuth = (
  baseline: OAuthBaseline | undefined,
  fields: OAuthFormFields,
): boolean => {
  if (!baseline) return true;
  return (
    isServerUrlChanged(baseline, fields) ||
    isOAuthClientChanged(baseline, fields) ||
    baseline.accountCount === 0
  );
};

/**
 * How many connected accounts saving would remove: the server clears them when
 * the URL or the client id changes, since their tokens belong to the old ones.
 */
export const countDroppedAccounts = (
  baseline: OAuthBaseline | undefined,
  fields: OAuthFormFields,
): number => {
  if (!baseline || baseline.accountCount === 0) return 0;
  return isServerUrlChanged(baseline, fields) || isOAuthClientIdChanged(baseline, fields)
    ? baseline.accountCount
    : 0;
};
