/**
 * Minimal identity information required before React mounts on Desktop.
 *
 * The user id is derived from the safe-storage-protected OIDC access token in
 * the main process. It selects an isolated local cache partition only; server
 * authorization continues to validate the token independently.
 */
export interface DesktopBootstrapIdentity {
  isIdentityResolved: boolean;
  userId?: string;
}

export interface DesktopBootProfilePayload {
  domContentLoadedMs: number;
  firstVisibleFrameMs: number;
  loadingScreenRemovedMs: number;
  navigationStartedAt: number;
}
