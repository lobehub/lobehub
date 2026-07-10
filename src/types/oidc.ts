export interface OidcClientMetadata {
  clientName?: string;
  isFirstParty: boolean;
  logo?: string;
}

export interface OidcInteractionDetailsResponse {
  clientId: string;
  clientMetadata: OidcClientMetadata;
  prompt: 'consent' | 'login';
  redirectUri?: string;
  scopes: string[];
  uid: string;
}

export interface OidcInteractionErrorResponse {
  error: 'server_error' | 'session_invalid' | 'unsupported_interaction';
  promptName?: string;
}
