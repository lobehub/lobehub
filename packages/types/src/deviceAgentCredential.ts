/**
 * Provider credentials a server installs on a connected device so the
 * heterogeneous agents there (Claude Code, Codex) run with them instead of a
 * local interactive login. The device-control RPCs `installAgentCredential`,
 * `removeAgentCredential` and `checkAgentCredential` carry these shapes.
 */

/** Heterogeneous agents that accept an installed credential. */
export type DeviceAgentCredentialProvider = 'claude-code' | 'codex';

export const DEVICE_AGENT_CREDENTIAL_PROVIDERS: readonly DeviceAgentCredentialProvider[] = [
  'claude-code',
  'codex',
];

/**
 * The secret itself. Never log, echo or persist it outside the device's
 * credential store.
 *
 * - `claude-oauth-token`: a Claude Code OAuth token, handed to the CLI as
 *   `CLAUDE_CODE_OAUTH_TOKEN`. `expiresAt` is an ISO date; once it passes the
 *   device refuses runs instead of falling back to another login.
 * - `codex-auth-json`: the full contents of a Codex `auth.json`.
 */
export type DeviceAgentCredentialSecret =
  | { expiresAt: string; token: string; type: 'claude-oauth-token' }
  | { authJson: string; type: 'codex-auth-json' };

export interface InstallAgentCredentialParams {
  provider: DeviceAgentCredentialProvider;
  secret: DeviceAgentCredentialSecret;
}

export interface InstallAgentCredentialResult {
  installed: true;
  provider: DeviceAgentCredentialProvider;
  /**
   * Runs on the replaced login that the device stopped first, so they could
   * not write it back over the new one. Omitted when none were running.
   */
  stoppedRuns?: number;
}

export interface RemoveAgentCredentialParams {
  provider: DeviceAgentCredentialProvider;
}

export interface RemoveAgentCredentialResult {
  /** `false` when nothing was installed; removing twice is not an error. */
  removed: boolean;
}

export interface CheckAgentCredentialParams {
  provider: DeviceAgentCredentialProvider;
}

export interface CheckAgentCredentialResult {
  checkedAt: string;
  /** ISO date the installed credential stops working, when it declares one. */
  expiresAt?: string;
  installed: boolean;
  /** The provider accepted the credential on a call that spends no model quota. */
  ok: boolean;
  /** Why `ok` is false (or a caveat when true). Never contains the secret. */
  reason?: string;
}

/**
 * Why a device client that cannot hold installed credentials refuses the
 * agent-credential RPCs. Shared so the server can tell "unsupported" apart.
 */
export const AGENT_CREDENTIAL_UNSUPPORTED_MESSAGE =
  'This device client does not support installed agent credentials';

/**
 * Prefix of every error the device's agent-credential handlers return, so the
 * server can tell a device-side failure from a gateway / transport one.
 */
export const AGENT_CREDENTIAL_ERROR_PREFIX = 'Agent credential error:';
