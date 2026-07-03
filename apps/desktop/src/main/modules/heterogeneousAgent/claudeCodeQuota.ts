import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  ClaudeCodeQuotaSnapshot,
  ClaudeCodeQuotaUnavailableReason,
  ClaudeCodeScopedWeekly,
  HeteroQuotaWindow,
} from '@lobechat/electron-client-ipc';

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// The usage endpoint is the Claude Code `/usage` API; it requires the CLI's
// OAuth beta header and rejects unknown clients, so mirror the CLI contract.
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const OAUTH_USER_AGENT = 'claude-cli/2.1.198 (external, cli)';
const USAGE_TIMEOUT_MS = 10_000;

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 3000;

// Same trio the session spawn strips from inherited env: when an agent
// explicitly configures one of these, `claude` runs on API-key/base-url auth
// and the subscription quota below does not apply to it.
const EXTERNAL_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

// Boolean-ish flags that route Claude Code to a third-party provider
// (AWS Bedrock / Google Vertex / Mantle), whose quotas are billed there —
// the Anthropic subscription quota does not apply to those runs either.
const EXTERNAL_ROUTING_FLAG_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

// The CLI treats these as booleans, so "0"/"false" must not count as enabled.
const isRoutingFlagEnabled = (value: string | undefined) =>
  !!value && !['0', 'false'].includes(value.trim().toLowerCase());

/**
 * Unlike the API-key trio (stripped from the inherited spawn env, so only the
 * agent's own env matters), routing flags inherited from the desktop process
 * DO reach the spawned CLI. Mirror the spawn-env merge: the agent env is
 * spread last and wins — even to disable an inherited flag — and the process
 * env fills the gaps.
 */
const effectiveRoutingFlag = (
  options: FetchClaudeCodeQuotaOptions,
  key: (typeof EXTERNAL_ROUTING_FLAG_ENV_KEYS)[number],
): string | undefined => (options.env && key in options.env ? options.env[key] : process.env[key]);

export interface FetchClaudeCodeQuotaOptions {
  claudeConfigDirPath?: string | null;
  env?: NodeJS.ProcessEnv;
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

const readKeychainCredentials = async (): Promise<ClaudeOAuthCredentials | null> => {
  if (process.platform !== 'darwin') return null;

  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
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
 * one is configured, only that profile's credentials file is consulted —
 * falling back to the default login would show another account's quota.
 */
const readClaudeOAuthCredentials = async (
  options: FetchClaudeCodeQuotaOptions,
): Promise<CredentialLookup> => {
  const explicitDir = resolveExplicitConfigDir(options);
  if (explicitDir) {
    const fromFile = await readFileCredentials(explicitDir);
    if (!fromFile) return { state: 'not-found' };
    return isExpired(fromFile) ? { state: 'expired' } : { credentials: fromFile, state: 'ok' };
  }

  const candidates: ClaudeOAuthCredentials[] = [];

  const fromKeychain = await readKeychainCredentials();
  if (fromKeychain) candidates.push(fromKeychain);

  const fromDefaultFile = await readFileCredentials(path.join(homedir(), '.claude'));
  if (fromDefaultFile) candidates.push(fromDefaultFile);

  if (candidates.length === 0) return { state: 'not-found' };

  const fresh = candidates.find((credentials) => !isExpired(credentials));
  return fresh ? { credentials: fresh, state: 'ok' } : { state: 'expired' };
};

interface OAuthUsageWindow {
  resets_at?: number | string;
  used_percentage?: number;
  utilization?: number;
}

interface OAuthUsageLimit {
  kind?: string;
  percent?: number;
  resets_at?: number | string;
  scope?: { model?: { display_name?: string } } | null;
}

interface OAuthUsageResponse {
  fable_seven_day?: OAuthUsageWindow;
  fable_weekly?: OAuthUsageWindow;
  five_hour?: OAuthUsageWindow;
  limits?: OAuthUsageLimit[];
  seven_day?: OAuthUsageWindow;
  seven_day_fable?: OAuthUsageWindow;
}

const parseResetsAt = (value: number | string | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value !== 'string' || !value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapUsageWindow = (
  raw: OAuthUsageWindow | undefined,
  windowMinutes: number,
): HeteroQuotaWindow | null => {
  const usedPercent =
    typeof raw?.utilization === 'number' && Number.isFinite(raw.utilization)
      ? raw.utilization
      : typeof raw?.used_percentage === 'number' && Number.isFinite(raw.used_percentage)
        ? raw.used_percentage
        : null;

  if (usedPercent === null) return null;

  return {
    resetsAt: parseResetsAt(raw?.resets_at),
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes,
  };
};

/**
 * Model-scoped weekly windows (e.g. the Fable weekly meter) are reported in
 * the `limits` array as `kind: 'weekly_scoped'` with the model display name in
 * `scope`, not as a top-level window field. Older deployments exposed a
 * `fable_*` top-level window instead, so keep those as a fallback.
 */
const mapScopedWeekly = (payload: OAuthUsageResponse): ClaudeCodeScopedWeekly | null => {
  const scoped = payload.limits?.find(
    (limit) =>
      limit?.kind === 'weekly_scoped' &&
      typeof limit.percent === 'number' &&
      Number.isFinite(limit.percent) &&
      typeof limit.scope?.model?.display_name === 'string' &&
      limit.scope.model.display_name.length > 0,
  );

  if (scoped) {
    return {
      modelName: scoped.scope!.model!.display_name!,
      window: {
        resetsAt: parseResetsAt(scoped.resets_at),
        usedPercent: Math.min(100, Math.max(0, scoped.percent!)),
        windowMinutes: 10_080,
      },
    };
  }

  const fableWindow = mapUsageWindow(
    payload.fable_weekly ?? payload.fable_seven_day ?? payload.seven_day_fable,
    10_080,
  );
  return fableWindow ? { modelName: 'Fable', window: fableWindow } : null;
};

export const fetchClaudeCodeQuota = async (
  options: FetchClaudeCodeQuotaOptions = {},
): Promise<ClaudeCodeQuotaSnapshot> => {
  const externalAuthKey =
    EXTERNAL_AUTH_ENV_KEYS.find((key) => asNonEmpty(options.env?.[key])) ??
    EXTERNAL_ROUTING_FLAG_ENV_KEYS.find((key) =>
      isRoutingFlagEnabled(effectiveRoutingFlag(options, key)),
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

    if (response.status === 401 || response.status === 403) {
      return unavailableSnapshot(
        'credentials-expired',
        `Anthropic usage API rejected the Claude Code login (${response.status})`,
      );
    }

    if (!response.ok) {
      return errorSnapshot(`Anthropic usage API returned ${response.status}`);
    }

    const payload = (await response.json()) as OAuthUsageResponse;

    return {
      error: null,
      provider: 'claude-code',
      scopedWeekly: mapScopedWeekly(payload),
      session: mapUsageWindow(payload.five_hour, 300),
      status: 'ok',
      updatedAt: Date.now(),
      weekly: mapUsageWindow(payload.seven_day, 10_080),
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
