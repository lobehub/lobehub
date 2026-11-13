/**
 * `lh connect --managed`: the agent of a managed cloud device. The platform
 * that runs the device injects its identity and a bootstrap secret through the
 * environment; the agent trades the secret for a short-lived gateway token and
 * keeps that token fresh for as long as it runs. Nothing is read from or
 * written to the stored login.
 */

import { BlockList, isIP } from 'node:net';

import dayjs from 'dayjs';
import { delay, retry } from 'es-toolkit';
import { z } from 'zod';

const MANAGED_DEVICE_ID_ENV = 'LOBEHUB_MANAGED_DEVICE_ID';
export const MANAGED_DEVICE_SECRET_ENV = 'LOBEHUB_MANAGED_DEVICE_SECRET';
const MANAGED_SERVER_ENV = 'LOBEHUB_SERVER';
export const MANAGED_GATEWAY_ENV = 'LOBEHUB_DEVICE_GATEWAY_URL';
const DEVICE_ACTIVITY_COMMAND_ENV = 'LOBEHUB_DEVICE_ACTIVITY_COMMAND';

const MANAGED_TOKEN_PATH = 'api/device/managed/token';

/** Refresh when this share of the token's lifetime has passed. */
const MANAGED_TOKEN_REFRESH_RATIO = 0.8;
/** Never schedule a refresh sooner than this, even for a nearly expired token. */
const MANAGED_TOKEN_MIN_REFRESH_DELAY_MS = 5000;
/** A longer lifetime is malformed; the server issues 1 h tokens. */
const MANAGED_TOKEN_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** Refresh delay used for a token whose lifetime is malformed. */
const MANAGED_TOKEN_FALLBACK_REFRESH_DELAY_MS = 5 * 60 * 1000;
const MANAGED_TOKEN_RETRY_INITIAL_DELAY_MS = 1000;
const MANAGED_TOKEN_RETRY_MAX_DELAY_MS = 60_000;
const MANAGED_TOKEN_REQUEST_TIMEOUT_MS = 15_000;

export interface ManagedDeviceConfig {
  /** The program and its arguments, run without a shell. */
  activityCommand?: string[];
  deviceId: string;
  gatewayUrl: string;
  secret: string;
  serverUrl: string;
}

export type ManagedDeviceConfigResult =
  { config: ManagedDeviceConfig; ok: true } | { message: string; ok: false };

const NOT_A_SERVICE_URL =
  'is not a valid service URL: it must use https (http only for a loopback address) and have no user name, password, query or fragment.';

const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK_ADDRESSES.addSubnet('::1', 128, 'ipv6');

/** `localhost`, or an IP address in 127.0.0.0/8 or ::1. `hostname` is `URL.hostname`. */
const isLoopbackHost = (hostname: string): boolean => {
  if (hostname === 'localhost') return true;
  const address = hostname.replace(/^\[(.*)]$/, '$1');
  const family = isIP(address);
  if (family === 0) return false;
  return LOOPBACK_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

/**
 * An https URL, or an http one to a loopback address; the secret and tokens
 * travel over it. A user name or password is rejected because a request to
 * such a URL fails with an error that repeats it. Returns the origin plus the
 * path without a trailing slash, so a path prefix is kept.
 */
const parseServiceUrl = (value: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.search || url.hash) return undefined;
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  if (!secure) return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

/** The program and its arguments, for example `["my-agent","touch"]`. */
const activityCommandSchema = z.array(z.string().min(1)).min(1);

/** A non-empty JSON array of non-empty strings, else `undefined`. */
const parseActivityCommand = (value: string): string[] | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const result = activityCommandSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
};

/**
 * Read the managed device settings from the environment. The message of a
 * failure names the variables only — never a value, so the secret cannot leak.
 */
export function readManagedDeviceConfig(
  env: NodeJS.ProcessEnv = process.env,
): ManagedDeviceConfigResult {
  const read = (name: string) => env[name]?.trim() || undefined;

  const deviceId = read(MANAGED_DEVICE_ID_ENV);
  const secret = read(MANAGED_DEVICE_SECRET_ENV);
  const server = read(MANAGED_SERVER_ENV);
  const gateway = read(MANAGED_GATEWAY_ENV);

  const missing = [
    !deviceId && MANAGED_DEVICE_ID_ENV,
    !secret && MANAGED_DEVICE_SECRET_ENV,
    !server && MANAGED_SERVER_ENV,
    !gateway && MANAGED_GATEWAY_ENV,
  ].filter((name): name is string => !!name);
  if (missing.length > 0) {
    return {
      message: `--managed needs these environment variables, which are not set: ${missing.join(', ')}.`,
      ok: false,
    };
  }

  const serverUrl = parseServiceUrl(server!);
  if (!serverUrl) {
    return { message: `${MANAGED_SERVER_ENV} ${NOT_A_SERVICE_URL}`, ok: false };
  }
  const gatewayUrl = parseServiceUrl(gateway!);
  if (!gatewayUrl) {
    return { message: `${MANAGED_GATEWAY_ENV} ${NOT_A_SERVICE_URL}`, ok: false };
  }

  const rawActivityCommand = read(DEVICE_ACTIVITY_COMMAND_ENV);
  const activityCommand = rawActivityCommand ? parseActivityCommand(rawActivityCommand) : undefined;
  if (rawActivityCommand && !activityCommand) {
    return {
      message: `${DEVICE_ACTIVITY_COMMAND_ENV} is not a JSON array of non-empty strings.`,
      ok: false,
    };
  }

  return {
    config: {
      activityCommand,
      deviceId: deviceId!,
      gatewayUrl,
      secret: secret!,
      serverUrl,
    },
    ok: true,
  };
}

export interface ManagedDeviceToken {
  /** Epoch milliseconds, server clock. */
  expiresAt: number;
  /**
   * Epoch milliseconds at which the server answered, server clock (its `Date`
   * header, else this machine's clock), so `expiresAt - issuedAt` is the
   * lifetime even when the two clocks disagree.
   */
  issuedAt: number;
  token: string;
}

export type ManagedTokenExchangeResult =
  | ({ status: 'issued' } & ManagedDeviceToken)
  /** 401: the secret is wrong or the device was deleted. */
  | { status: 'invalid-credentials' }
  /** 404: this server has no managed cloud devices. */
  | { status: 'unavailable' }
  /** Any other 4xx: the request itself is wrong, so a retry cannot help. */
  | { httpStatus: number; status: 'rejected' }
  /** 408, 429, 5xx, a network error or an unreadable body. */
  | { reason: string; status: 'retryable' };

/** The token route's 200 body. `expiresAt` is RFC 3339 with a `Z` or an offset. */
const managedTokenResponseSchema = z.object({
  expiresAt: z.iso.datetime({ offset: true }),
  token: z.string().min(1),
});

export async function exchangeManagedDeviceToken({
  deviceId,
  secret,
  serverUrl,
}: Pick<
  ManagedDeviceConfig,
  'deviceId' | 'secret' | 'serverUrl'
>): Promise<ManagedTokenExchangeResult> {
  let response: Response;
  try {
    // Relative to the server URL with a trailing slash, so a path prefix is kept.
    response = await fetch(new URL(MANAGED_TOKEN_PATH, `${serverUrl}/`).href, {
      body: JSON.stringify({ deviceId, secret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(MANAGED_TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return { reason: (err as Error).message || 'network error', status: 'retryable' };
  }

  if (response.status === 401) return { status: 'invalid-credentials' };
  if (response.status === 404) return { status: 'unavailable' };
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { reason: `HTTP ${response.status}`, status: 'retryable' };
  }
  if (!response.ok) return { httpStatus: response.status, status: 'rejected' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { reason: 'the response is not JSON', status: 'retryable' };
  }
  const parsed = managedTokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { reason: 'the response has no token or expiresAt', status: 'retryable' };
  }

  const dateHeader = response.headers.get('date');
  const serverDate = dateHeader ? dayjs(dateHeader) : undefined;
  return {
    expiresAt: dayjs(parsed.data.expiresAt).valueOf(),
    issuedAt: serverDate?.isValid() ? serverDate.valueOf() : Date.now(),
    status: 'issued',
    token: parsed.data.token,
  };
}

/**
 * Which gateway principal the token belongs to. A workspace device's token
 * carries `workspace_id`; otherwise `sub` is the owning user.
 */
export function readManagedTokenPrincipal(
  token: string,
): { userId: string; workspaceId?: undefined } | { userId?: undefined; workspaceId: string } {
  let payload: { sub?: unknown; workspace_id?: unknown };
  try {
    payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch {
    throw new Error('The managed device token is not a JWT.');
  }
  if (typeof payload.workspace_id === 'string' && payload.workspace_id) {
    return { workspaceId: payload.workspace_id };
  }
  if (typeof payload.sub === 'string' && payload.sub) return { userId: payload.sub };
  throw new Error('The managed device token has no sub or workspace_id claim.');
}

/**
 * Delay before refreshing a token: 80% of its lifetime, at least 5 s. A
 * lifetime above 24 h is malformed and gets the 5 min fallback, which also
 * keeps the delay inside the range `setTimeout` accepts.
 */
export function getManagedTokenRefreshDelay(token: ManagedDeviceToken): number {
  const lifetime = token.expiresAt - token.issuedAt;
  if (lifetime > MANAGED_TOKEN_MAX_LIFETIME_MS) return MANAGED_TOKEN_FALLBACK_REFRESH_DELAY_MS;
  return Math.max(MANAGED_TOKEN_MIN_REFRESH_DELAY_MS, lifetime * MANAGED_TOKEN_REFRESH_RATIO);
}

/** Retry delay after `attempt` failures (1-based): 1 s doubling to 60 s, ±20% jitter. */
export function getManagedTokenRetryDelay(attempt: number) {
  const base = Math.min(
    MANAGED_TOKEN_RETRY_MAX_DELAY_MS,
    MANAGED_TOKEN_RETRY_INITIAL_DELAY_MS * 2 ** (attempt - 1),
  );
  return Math.round(base * (0.8 + 0.4 * Math.random()));
}

type FatalExchangeResult = Exclude<ManagedTokenExchangeResult, { status: 'issued' | 'retryable' }>;

/** A token exchange answer that retrying cannot change. */
export class ManagedTokenFatalError extends Error {
  constructor(result: FatalExchangeResult) {
    super(describeFatalResult(result));
    this.name = 'ManagedTokenFatalError';
  }
}

/** A token exchange answer that a later attempt may change: 408, 429, 5xx, network. */
class ManagedTokenRetryableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ManagedTokenRetryableError';
  }
}

function describeFatalResult(result: FatalExchangeResult): string {
  switch (result.status) {
    case 'invalid-credentials': {
      return `The server rejected ${MANAGED_DEVICE_ID_ENV} / ${MANAGED_DEVICE_SECRET_ENV} (HTTP 401).`;
    }
    case 'unavailable': {
      return 'This server does not offer managed cloud devices (HTTP 404).';
    }
    case 'rejected': {
      return `The server rejected the managed device token request (HTTP ${result.httpStatus}).`;
    }
  }
}

export interface ManagedTokenSessionOptions {
  config: Pick<ManagedDeviceConfig, 'deviceId' | 'secret' | 'serverUrl'>;
  logger: { debug: (msg: string) => void; warn: (msg: string) => void };
  /** A background refresh got an answer that retrying cannot change. */
  onFatal: (error: ManagedTokenFatalError) => void;
  /** A new token arrived, from a scheduled refresh or `refreshNow()`. */
  onToken: (token: ManagedDeviceToken) => void;
}

/**
 * Owns the managed device's gateway token: gets the first one, refreshes it
 * at 80% of its lifetime, and retries 5xx / network failures with backoff
 * until the server answers. A 401, 404 or other 4xx is final.
 */
export class ManagedTokenSession {
  /** Aborted by `stop()`; ends a pending retry wait at once. */
  private readonly abort = new AbortController();
  private inFlight: Promise<ManagedDeviceToken> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ManagedTokenSessionOptions) {}

  /** Get the first token and schedule its refresh. Rejects only on a final answer. */
  async start(): Promise<ManagedDeviceToken> {
    const token = await this.obtain();
    this.schedule(token);
    return token;
  }

  /** Get a new token now (e.g. the gateway rejected the current one). */
  async refreshNow(): Promise<ManagedDeviceToken> {
    this.clearTimer();
    const token = await this.obtain();
    this.options.onToken(token);
    this.schedule(token);
    return token;
  }

  stop(): void {
    this.abort.abort();
    this.clearTimer();
  }

  private schedule(token: ManagedDeviceToken) {
    this.clearTimer();
    if (this.abort.signal.aborted) return;
    const refreshDelay = getManagedTokenRefreshDelay(token);
    this.options.logger.debug(
      `Scheduled managed device token refresh in ${Math.round(refreshDelay / 1000)}s`,
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refreshNow().catch((err) => {
        if (err instanceof ManagedTokenFatalError) this.options.onFatal(err);
      });
    }, refreshDelay);
    this.timer.unref?.();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** One exchange at a time; concurrent callers share it. */
  private obtain(): Promise<ManagedDeviceToken> {
    this.inFlight ??= this.exchangeWithRetry().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async exchangeWithRetry(): Promise<ManagedDeviceToken> {
    const { signal } = this.abort;
    // es-toolkit's `retry` checks `signal` only before an attempt and does not
    // pass it to its own wait, so a stop during a 60 s backoff would hang
    // until the wait ended. The backoff therefore runs at the start of the
    // next attempt, through `delay`, which rejects as soon as `signal` aborts.
    let backoff = 0;
    try {
      return await retry(
        async () => {
          if (backoff > 0) await delay(backoff, { signal });
          const result = await exchangeManagedDeviceToken(this.options.config);
          switch (result.status) {
            case 'issued': {
              const { expiresAt, issuedAt, token } = result;
              return { expiresAt, issuedAt, token };
            }
            case 'retryable': {
              throw new ManagedTokenRetryableError(result.reason);
            }
            default: {
              throw new ManagedTokenFatalError(result);
            }
          }
        },
        {
          // `attempts` counts from 0, so the first backoff is about 1 s.
          delay: (attempts, error) => {
            backoff = getManagedTokenRetryDelay(attempts + 1);
            this.options.logger.warn(
              `Could not get a managed device token (${(error as ManagedTokenRetryableError).reason}); retrying in ${Math.round(backoff / 1000)}s`,
            );
            return 0;
          },
          shouldRetry: (error) => error instanceof ManagedTokenRetryableError,
          signal,
        },
      );
    } catch (err) {
      if (signal.aborted) {
        throw new Error('The managed device token session was stopped.', { cause: err });
      }
      throw err;
    }
  }
}
