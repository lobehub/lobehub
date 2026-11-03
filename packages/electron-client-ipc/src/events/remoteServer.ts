export interface MarketAuthorizationParams {
  authUrl: string;
}

/**
 * Authorization phase for progress tracking
 */
export type AuthorizationPhase =
  | 'browser_opened' // Browser has been opened for authorization
  | 'waiting_for_auth' // Waiting for user to complete browser login
  | 'verifying' // Received credentials, verifying with server
  | 'cancelled'; // Authorization was cancelled by user

/**
 * Authorization progress info for UI updates
 */
export interface AuthorizationProgress {
  /** Elapsed time in milliseconds since authorization started */
  elapsed: number;
  /** Maximum polling time in milliseconds */
  maxPollTime: number;
  /** Current authorization phase */
  phase: AuthorizationPhase;
}

/**
 * Remote server related events broadcast from main process
 */
export interface RemoteServerBroadcastEvents {
  authorizationFailed: (params: { error: string }) => void;
  /** Broadcast authorization progress for UI updates */
  authorizationProgress: (params: AuthorizationProgress) => void;
  /**
   * Broadcast when the main process needs the user to re-authenticate.
   * `reason` is a short, log-friendly tag describing why (e.g. `refresh:invalid_grant`,
   * `proxy:status=401`, `startup:non_retryable`). Useful for diagnosing why the
   * Session Expired modal showed up in field reports.
   */
  authorizationRequired: (params: { reason: string }) => void;
  authorizationSuccessful: (params: void) => void;
  remoteServerConfigUpdated: (params: void) => void;
  tokenRefreshed: (params: void) => void;
}
