import type { ProjectMemberRole } from '@lobechat/types';

export interface OidcClientMetadata {
  clientName?: string;
  developerName?: string;
  isFirstParty: boolean;
  logo?: string;
  policyUri?: string;
}

export interface OidcInteractionDetailsResponse {
  acceptanceReview?: {
    allowed: boolean;
    kind: 'acceptance' | 'site';
    origin?: string;
    projectName?: string;
    reason?: 'noAccess' | 'unregistered';
    role?: ProjectMemberRole | null;
    siteName?: string;
    title?: string;
  };
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
