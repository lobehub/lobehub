/**
 * OIDC business slot.
 *
 * The open-source distribution registers its own first-party clients in
 * `src/libs/oidc-provider/config.ts`. A distribution adds further statically
 * registered clients here; the default registers none.
 */

/**
 * The subset of oidc-provider client metadata a distribution registers.
 * Kept structural so this package does not depend on oidc-provider.
 */
export interface BusinessOidcClientMetadata {
  [key: string]: unknown;
  application_type?: 'native' | 'web';
  client_id: string;
  client_name?: string;
  grant_types?: string[];
  logo_uri?: string;
  post_logout_redirect_uris?: string[];
  redirect_uris?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

export const BUSINESS_OIDC_CLIENTS: BusinessOidcClientMetadata[] = [];
