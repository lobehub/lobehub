import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  buildKimiCodeQuotaWindows,
  KIMI_CODE_MONTHLY_WINDOW_MINUTES,
  KIMI_CODE_SESSION_WINDOW_MINUTES,
  KIMI_CODE_WEEKLY_WINDOW_MINUTES,
  kimiCodeQuotaReadings,
} from '../quota/kimiCode';
import type {
  HeteroQuotaWindow,
  KimiCodeExtraUsage,
  KimiCodeQuotaSnapshot,
  KimiCodeQuotaUnavailableReason,
} from '../quota/snapshot';
import type { QuotaAccountIdentity } from '../quota/types';

/**
 * How long a sampler host's snapshot cache may serve a Kimi Code quota reading
 * without re-hitting the usage API. Matches the Claude cadence so every
 * scheduled poll observes fresh data, while bursts still coalesce.
 */
export const KIMI_CODE_QUOTA_FRESH_MS = 90_000;

const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
const OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const OAUTH_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token';
const REQUEST_TIMEOUT_MS = 10_000;
// Refresh a token expiring within this window instead of racing its expiry
// mid-request.
const TOKEN_EXPIRY_SKEW_MS = 60_000;
// Booster wallet amounts are fixed-point: value / 1_000_000 = cents.
const FIXED_POINT_CENTS = 1_000_000;

export interface FetchKimiCodeQuotaOptions {
  /**
   * Agent-configured env overrides. A plain record rather than
   * `NodeJS.ProcessEnv`: the root app augments `ProcessEnv` with required
   * keys, which would make callers' partial env objects unassignable.
   */
  env?: Record<string, string | undefined>;
  kimiCodeHomePath?: string | null;
}

interface KimiCodeCredentialsFile {
  [key: string]: unknown;
  access_token?: unknown;
  expires_at?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}

type AccessTokenLookup =
  | { accessToken: string; state: 'ok' }
  | { message: string; state: 'error' }
  | { state: 'expired' }
  | { state: 'not-found' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// A trailing-slash regex (`/\/+$/`) is polynomial on slash-heavy input
// (CodeQL js/redos); trim by index instead.
const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const asNonEmpty = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const getKimiCodeHomePath = (options: FetchKimiCodeQuotaOptions) =>
  asNonEmpty(options.kimiCodeHomePath) ??
  asNonEmpty(options.env?.KIMI_CODE_HOME) ??
  asNonEmpty(process.env.KIMI_CODE_HOME) ??
  path.join(homedir(), '.kimi-code');

const getKimiCodeBaseUrl = (options: FetchKimiCodeQuotaOptions) =>
  trimTrailingSlashes(
    asNonEmpty(options.env?.KIMI_CODE_BASE_URL) ??
      asNonEmpty(process.env.KIMI_CODE_BASE_URL) ??
      DEFAULT_BASE_URL,
  );

const baseSnapshot = () => ({
  extraUsage: null,
  monthly: null,
  monthlyCode: null,
  provider: 'kimi-code' as const,
  session: null,
  updatedAt: Date.now(),
  weekly: null,
});

const errorSnapshot = (message: string): KimiCodeQuotaSnapshot => ({
  ...baseSnapshot(),
  error: message,
  status: 'error',
});

const unavailableSnapshot = (reason: KimiCodeQuotaUnavailableReason): KimiCodeQuotaSnapshot => ({
  ...baseSnapshot(),
  error: null,
  reason,
  status: 'unavailable',
});

/**
 * Exchange the refresh token for a new access token and persist the rotated
 * credentials back to the CLI's credential file. A 4xx (or `invalid_grant`)
 * means the login itself is gone; transport failures are transient errors.
 */
const refreshAccessToken = async (
  credentialsPath: string,
  credentials: KimiCodeCredentialsFile,
  refreshToken: string,
): Promise<AccessTokenLookup> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch (error) {
    return {
      message: `Kimi Code token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      state: 'error',
    };
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  const errorCode = isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';

  if ((response.status >= 400 && response.status < 500) || errorCode === 'invalid_grant') {
    return { state: 'expired' };
  }

  const newAccessToken =
    isRecord(payload) && typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!response.ok || !newAccessToken) {
    return { message: `Kimi Code token refresh failed (${response.status})`, state: 'error' };
  }

  const expiresIn =
    isRecord(payload) &&
    typeof payload.expires_in === 'number' &&
    Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 3600;

  const nextCredentials = {
    ...credentials,
    ...(isRecord(payload) ? payload : {}),
    access_token: newAccessToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token:
      isRecord(payload) && typeof payload.refresh_token === 'string' && payload.refresh_token
        ? payload.refresh_token
        : refreshToken,
  };

  try {
    await writeFile(credentialsPath, JSON.stringify(nextCredentials, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // The rotated token is usable for this run even if persisting it fails.
  }

  return { accessToken: newAccessToken, state: 'ok' };
};

/**
 * Locate the Kimi Code OAuth login written by the `kimi` CLI
 * (`$KIMI_CODE_HOME/credentials/kimi-code.json`) and return a usable access
 * token, refreshing it when it is about to expire.
 */
const resolveAccessToken = async (
  options: FetchKimiCodeQuotaOptions,
): Promise<AccessTokenLookup> => {
  const credentialsPath = path.join(getKimiCodeHomePath(options), 'credentials', 'kimi-code.json');

  let credentials: KimiCodeCredentialsFile;
  try {
    credentials = JSON.parse(await readFile(credentialsPath, 'utf8')) as KimiCodeCredentialsFile;
  } catch {
    return { state: 'not-found' };
  }

  const accessToken = typeof credentials.access_token === 'string' ? credentials.access_token : '';
  if (!accessToken) return { state: 'not-found' };

  const expiresAtMs =
    typeof credentials.expires_at === 'number' ? credentials.expires_at * 1000 : 0;
  if (expiresAtMs - Date.now() > TOKEN_EXPIRY_SKEW_MS) return { accessToken, state: 'ok' };

  const refreshToken =
    typeof credentials.refresh_token === 'string' ? credentials.refresh_token : '';
  if (!refreshToken) return { state: 'expired' };

  return refreshAccessToken(credentialsPath, credentials, refreshToken);
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const intValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed === undefined ? null : Math.trunc(parsed);
};

const fixedPointToCents = (value: number): number => {
  const cents = value / FIXED_POINT_CENTS;
  if (cents > 0 && cents < 1) return 1;
  return Math.round(cents);
};

const parseUsageWindow = (raw: unknown, windowMinutes: number): HeteroQuotaWindow | null => {
  if (!isRecord(raw)) return null;
  const usedRatio = numberValue(raw.used_ratio);
  if (usedRatio === undefined) return null;
  const resetTime = typeof raw.reset_time === 'string' ? Date.parse(raw.reset_time) : Number.NaN;

  return {
    resetsAt: Number.isFinite(resetTime) ? resetTime : null,
    usedPercent: usedRatio * 100,
    windowMinutes,
  };
};

const parseMoney = (raw: unknown): { cents: number; currency: string } | null => {
  if (!isRecord(raw)) return null;
  const cents = intValue(raw.priceInCents);
  if (cents === null) return null;
  return { cents, currency: typeof raw.currency === 'string' ? raw.currency : '' };
};

const parseBoosterWallet = (raw: unknown): KimiCodeExtraUsage | null => {
  if (!isRecord(raw) || !isRecord(raw.balance)) return null;
  if (raw.balance.type !== 'BOOSTER') return null;
  const amount = intValue(raw.balance.amount);
  if (amount === null || amount <= 0) return null;
  const amountLeft = intValue(raw.balance.amountLeft);

  const monthlyLimit = parseMoney(raw.monthlyChargeLimit);
  const monthlyUsed = parseMoney(raw.monthlyUsed);

  return {
    balanceCents: amountLeft === null ? 0 : fixedPointToCents(amountLeft),
    currency: monthlyLimit?.currency || monthlyUsed?.currency || 'USD',
    monthlyChargeLimitCents: monthlyLimit?.cents ?? 0,
    monthlyChargeLimitEnabled: raw.monthlyChargeLimitEnabled === true,
    monthlyUsedCents: monthlyUsed?.cents ?? 0,
    totalCents: fixedPointToCents(amount),
  };
};

/**
 * Best-effort account identity from `{baseUrl}/me`. Failure must never fail
 * the quota snapshot, so every error collapses to `null`.
 */
const fetchKimiCodeIdentity = async (
  baseUrl: string,
  accessToken: string,
): Promise<QuotaAccountIdentity | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.user_id !== 'string' || !payload.user_id) return null;

    return {
      displayName:
        typeof payload.nickname === 'string' && payload.nickname ? payload.nickname : undefined,
      email: typeof payload.email === 'string' && payload.email ? payload.email : undefined,
      externalAccountId: payload.user_id,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchKimiCodeQuota = async (
  options: FetchKimiCodeQuotaOptions = {},
): Promise<KimiCodeQuotaSnapshot> => {
  const lookup = await resolveAccessToken(options);
  if (lookup.state === 'not-found') return unavailableSnapshot('credentials-not-found');
  if (lookup.state === 'expired') return unavailableSnapshot('credentials-expired');
  if (lookup.state === 'error') return errorSnapshot(lookup.message);

  const baseUrl = getKimiCodeBaseUrl(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/usages`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${lookup.accessToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return errorSnapshot(`Kimi Code usage API returned ${response.status}`);
    }

    const payload: unknown = await response.json();
    const usages = isRecord(payload) && isRecord(payload.usages) ? payload.usages : {};
    const capturedAt = Date.now();
    // The panel windows are projected from the same readings we persist, so a
    // limit can never render live yet go missing from the account's history.
    const readings = kimiCodeQuotaReadings(
      {
        monthly: parseUsageWindow(usages.limit_month_total, KIMI_CODE_MONTHLY_WINDOW_MINUTES),
        monthlyCode: parseUsageWindow(usages.limit_month_code, KIMI_CODE_MONTHLY_WINDOW_MINUTES),
        session: parseUsageWindow(usages.limit_5h, KIMI_CODE_SESSION_WINDOW_MINUTES),
        weekly: parseUsageWindow(usages.limit_7d, KIMI_CODE_WEEKLY_WINDOW_MINUTES),
      },
      capturedAt,
    );
    const windows = buildKimiCodeQuotaWindows(readings, capturedAt);

    return {
      error: null,
      extraUsage: parseBoosterWallet(isRecord(payload) ? payload.boosterWallet : null),
      identity: await fetchKimiCodeIdentity(baseUrl, lookup.accessToken),
      monthly: windows.monthly,
      monthlyCode: windows.monthlyCode,
      provider: 'kimi-code',
      readings,
      session: windows.session,
      status: 'ok',
      updatedAt: capturedAt,
      weekly: windows.weekly,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return errorSnapshot('Kimi Code usage API request timed out');
    }

    return errorSnapshot(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
};
