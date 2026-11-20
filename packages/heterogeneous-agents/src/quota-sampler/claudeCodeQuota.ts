import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ClaudeCodeExternalRoutingEnvKey } from '../quota/claudeCodeRouting';
import {
  CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS,
  isClaudeCodeRoutingFlagEnabled,
} from '../quota/claudeCodeRouting';
import { buildClaudeQuotaWindows } from '../quota/readings';
import type { ClaudeCodeQuotaSnapshot, ClaudeCodeQuotaUnavailableReason } from '../quota/snapshot';
import { parseClaudeAccountIdentity } from './identity';
import type { ClaudeUsagePayload } from './usageApi';
import { mapClaudeUsageToReadings } from './usageApi';

/**
 * How long a sampler host's snapshot cache may serve a Claude quota reading
 * without re-hitting the usage API. Kept just under the UI's 2-minute
 * auto-refresh cadence so every scheduled poll observes fresh data, while
 * bursts (multiple renderers / rapid re-mounts) still coalesce.
 */
export const CLAUDE_CODE_QUOTA_FRESH_MS = 90_000;

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// The usage endpoint is the Claude Code `/usage` API; it requires the CLI's
// OAuth beta header and rejects unknown clients, so mirror the CLI contract.
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const OAUTH_USER_AGENT = 'claude-cli/2.1.198 (external, cli)';
const USAGE_TIMEOUT_MS = 10_000;

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 3000;

/**
 * The macOS Keychain item the CLI stores a login under. The default profile
 * uses the bare service name; a `CLAUDE_CONFIG_DIR` profile gets its own item,
 * suffixed with the first 8 hex chars of the SHA-256 of the (NFC) dir path —
 * so two profiles never share, or overwrite, one login.
 */
export const claudeCodeKeychainService = (configDir?: string | null): string =>
  configDir
    ? `${KEYCHAIN_SERVICE}-${createHash('sha256')
        .update(configDir.normalize('NFC'))
        .digest('hex')
        .slice(0, 8)}`
    : KEYCHAIN_SERVICE;

// Same trio the session spawn strips from inherited env: when an agent
// explicitly configures one of these, `claude` runs on API-key/base-url auth
// and the subscription quota below does not apply to it.
const EXTERNAL_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

/**
 * Unlike the API-key trio (stripped from the inherited spawn env, so only the
 * agent's own env matters), routing flags inherited from the desktop process
 * DO reach the spawned CLI. Mirror the spawn-env merge: the agent env is
 * spread last and wins — even to disable an inherited flag — and the process
 * env fills the gaps.
 */
const effectiveRoutingFlag = (
  options: FetchClaudeCodeQuotaOptions,
  key: ClaudeCodeExternalRoutingEnvKey,
): string | undefined => (options.env && key in options.env ? options.env[key] : process.env[key]);

export interface FetchClaudeCodeQuotaOptions {
  claudeConfigDirPath?: string | null;
  /**
   * Agent-configured env overrides. A plain record rather than
   * `NodeJS.ProcessEnv`: the root app augments `ProcessEnv` with required
   * keys, which would make callers' partial env objects unassignable.
   */
  env?: Record<string, string | undefined>;
}

interface ClaudeOAuthCredentials {
  accessToken: string;
  /** Unix ms timestamp; absent in older credential formats. */
  expiresAt?: number;
}

type CredentialLookup =
  | { credentials: ClaudeOAuthCredentials; state: 'ok' }
  | { state: 'expired' }
  | { state: 'not-found' };

const baseSnapshot = () => ({
  provider: 'claude-code' as const,
  scopedWeekly: null,
  session: null,
  updatedAt: Date.now(),
  weekly: null,
});

const errorSnapshot = (message: string): ClaudeCodeQuotaSnapshot => ({
  ...baseSnapshot(),
  error: message,
  status: 'error',
});

const unavailableSnapshot = (
  reason: ClaudeCodeQuotaUnavailableReason,
  message: string,
): ClaudeCodeQuotaSnapshot => ({
  ...baseSnapshot(),
  error: message,
  reason,
  status: 'unavailable',
});

/**
 * Anthropic answers a request from a blocked network or region with a 403
 * `forbidden` error ("Request not allowed") before it ever looks at the token,
 * so it says nothing about the login. A 403 for a bad token carries an auth /
 * permission error type instead.
 */
const isRequestBlocked = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: { type?: unknown } };
    return body?.error?.type === 'forbidden';
  } catch {
    return false;
  }
};

const parseCredentialsJson = (raw: string): ClaudeOAuthCredentials | null => {
  try {
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };
    const oauth = parsed?.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;

    return {
      accessToken: oauth.accessToken,
      ...(typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt)
        ? { expiresAt: oauth.expiresAt }
        : {}),
    };
  } catch {
    return null;
  }
};

const readKeychainCredentials = async (
  configDir?: string | null,
): Promise<ClaudeOAuthCredentials | null> => {
  if (process.platform !== 'darwin') return null;

  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', claudeCodeKeychainService(configDir), '-w'],
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (error, stdout) => {
        resolve(error ? null : parseCredentialsJson(stdout.trim()));
      },
    );
  });
};

const readFileCredentials = async (configDir: string): Promise<ClaudeOAuthCredentials | null> => {
  try {
    return parseCredentialsJson(await readFile(path.join(configDir, '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
};

const asNonEmpty = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

/**
 * The config dir the spawned CLI would resolve: the explicit option, then the
 * agent's session env (spread last onto the spawn env, so it wins), then the
 * env inherited from the desktop process.
 */
const resolveExplicitConfigDir = (options: FetchClaudeCodeQuotaOptions): string | null =>
  asNonEmpty(options.claudeConfigDirPath) ??
  asNonEmpty(options.env?.CLAUDE_CONFIG_DIR) ??
  asNonEmpty(process.env.CLAUDE_CONFIG_DIR);

const isExpired = (credentials: ClaudeOAuthCredentials) =>
  typeof credentials.expiresAt === 'number' && credentials.expiresAt <= Date.now();

/**
 * Locate the freshest Claude Code OAuth login. Access tokens are short-lived
 * and only the `claude` CLI may rotate them (refreshing here would race the
 * CLI's own refresh-token rotation and could log the user out), so an expired
 * credential is reported as such instead of being refreshed.
 *
 * A custom `CLAUDE_CONFIG_DIR` is an isolated CLI profile: `claude` ignores
 * the default Keychain / `~/.claude` login there (with a fresh default login
 * and an empty custom dir, `claude auth status` reports logged out). So when
 * one is configured, only that profile's own Keychain item and credentials
 * file are consulted — falling back to the default login would show another
 * account's quota.
 */
const readClaudeOAuthCredentials = async (
  options: FetchClaudeCodeQuotaOptions,
): Promise<CredentialLookup> => {
  const explicitDir = resolveExplicitConfigDir(options);
  const candidates: ClaudeOAuthCredentials[] = [];

  const fromKeychain = await readKeychainCredentials(explicitDir);
  if (fromKeychain) candidates.push(fromKeychain);

  const fromFile = await readFileCredentials(explicitDir ?? path.join(homedir(), '.claude'));
  if (fromFile) candidates.push(fromFile);

  if (candidates.length === 0) return { state: 'not-found' };

  const fresh = candidates.find((credentials) => !isExpired(credentials));
  return fresh ? { credentials: fresh, state: 'ok' } : { state: 'expired' };
};

/**
 * Whether the profile a spawn with these options would use holds a login at
 * all. An expired access token still counts: the CLI refreshes it on its own,
 * so only a profile with no credential anywhere is signed out.
 */
export const hasClaudeCodeLogin = async (options: FetchClaudeCodeQuotaOptions): Promise<boolean> =>
  (await readClaudeOAuthCredentials(options)).state !== 'not-found';

/**
 * Read the account identity for DB persistence. `~/.claude.json` (or the
 * explicit profile dir's copy) carries `oauthAccount`; the credential blob
 * itself has no identity. Best-effort — quota still works without it.
 */
/**
 * Identity of the login a spawn with this env would actually use — pure local
 * file read (no usage-API call), so it is safe to invoke once per run for
 * usage→account attribution.
 */
export const readClaudeCodeIdentity = async (options: FetchClaudeCodeQuotaOptions) =>
  readAccountIdentity(options);

const readAccountIdentity = async (options: FetchClaudeCodeQuotaOptions) => {
  const explicit = resolveExplicitConfigDir(options);
  const candidates = explicit
    ? [path.join(explicit, '.claude.json')]
    : [path.join(homedir(), '.claude.json')];
  for (const file of candidates) {
    try {
      const identity = parseClaudeAccountIdentity(await readFile(file, 'utf8'));
      if (identity) return identity;
    } catch {
      /* try next */
    }
  }
  return null;
};

export const fetchClaudeCodeQuota = async (
  options: FetchClaudeCodeQuotaOptions = {},
): Promise<ClaudeCodeQuotaSnapshot> => {
  const externalAuthKey =
    EXTERNAL_AUTH_ENV_KEYS.find((key) => asNonEmpty(options.env?.[key])) ??
    CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS.find((key) =>
      isClaudeCodeRoutingFlagEnabled(effectiveRoutingFlag(options, key)),
    );
  if (externalAuthKey) {
    return unavailableSnapshot(
      'external-auth',
      `Subscription quota does not apply when ${externalAuthKey} is configured`,
    );
  }

  const lookup = await readClaudeOAuthCredentials(options);
  if (lookup.state === 'not-found') {
    return unavailableSnapshot('credentials-not-found', 'Claude Code login credentials not found');
  }
  if (lookup.state === 'expired') {
    return unavailableSnapshot('credentials-expired', 'Claude Code login has expired');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);

  try {
    const response = await fetch(OAUTH_USAGE_URL, {
      headers: {
        'Authorization': `Bearer ${lookup.credentials.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': OAUTH_USER_AGENT,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
      signal: controller.signal,
    });

    if (response.status === 403 && (await isRequestBlocked(response))) {
      return unavailableSnapshot(
        'request-blocked',
        'Anthropic usage API blocked the request from this network (403)',
      );
    }

    if (response.status === 401 || response.status === 403) {
      return unavailableSnapshot(
        'credentials-expired',
        `Anthropic usage API rejected the Claude Code login (${response.status})`,
      );
    }

    if (!response.ok) {
      return errorSnapshot(`Anthropic usage API returned ${response.status}`);
    }

    const payload = (await response.json()) as ClaudeUsagePayload;
    const capturedAt = Date.now();
    // The panel windows are projected from the same readings we persist, so a
    // limit can never render live yet go missing from the account's history.
    const readings = mapClaudeUsageToReadings(payload, capturedAt);
    const windows = buildClaudeQuotaWindows(readings, capturedAt);

    return {
      error: null,
      identity: await readAccountIdentity(options),
      provider: 'claude-code',
      readings,
      scopedWeekly: windows.scopedWeekly,
      session: windows.session,
      status: 'ok',
      updatedAt: capturedAt,
      weekly: windows.weekly,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return errorSnapshot('Anthropic usage API request timed out');
    }

    return errorSnapshot(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
};
