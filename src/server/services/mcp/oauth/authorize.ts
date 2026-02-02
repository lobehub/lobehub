/**
 * Build authorization URL with PKCE (code_challenge) and state.
 * RFC 6749, RFC 7636.
 */
export function buildAuthorizeUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scope?: string;
  state: string;
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', params.state);
  if (params.scope) {
    url.searchParams.set('scope', params.scope);
  }
  return url.toString();
}
