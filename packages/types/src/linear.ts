/**
 * Linear integration domain: a LobeHub user's OAuth connection to a Linear
 * organization.
 */

/** `{ accessToken, refreshToken? }` as stored encrypted in `linear_connections.credentials`. */
export interface LinearConnectionCredentials {
  accessToken: string;
  refreshToken?: string;
}

/** Display facts about the organization and the person who connected it. */
export interface LinearConnectionMetadata {
  /** Avatar of the Linear user who authorized the connection. */
  actorAvatarUrl?: string;
  organizationLogoUrl?: string;
  /** OAuth scopes Linear granted. */
  scopes?: string[];
}

/** Connection as the client sees it: never carries credentials. */
export interface LinearConnectionView {
  actorExternalId: string;
  actorName: string;
  createdAt: Date;
  id: string;
  metadata: LinearConnectionMetadata;
  organizationId: string;
  organizationName: string;
  organizationUrlKey: string;
  userId: string;
  workspaceId: string | null;
}
