import { createPrivateKey, type KeyObject, sign } from 'node:crypto';
import http2 from 'node:http2';

import type { ApnsEnvironment } from '@lobechat/types';

/** Token-based (.p8) APNs credentials, read from the server environment. */
export interface ApnsConfig {
  /** Default APNs topic when a registration carries no bundle id. */
  bundleId?: string;
  /** PEM contents of the .p8 auth key. */
  key: string;
  keyId: string;
  teamId: string;
}

/**
 * Reads `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY` and the optional
 * `APNS_BUNDLE_ID`. `APNS_KEY` is the .p8 file contents; escaped `\n` (as
 * stored by most secret managers) and base64 of the whole file are accepted.
 * Returns `undefined` when any required value is missing.
 */
export const getApnsConfigFromEnv = (env = process.env): ApnsConfig | undefined => {
  const { APNS_BUNDLE_ID, APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID } = env;
  if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID) return undefined;

  let key = APNS_KEY.replaceAll('\\n', '\n').trim();
  if (!key.includes('-----BEGIN')) key = Buffer.from(key, 'base64').toString('utf8').trim();

  return { bundleId: APNS_BUNDLE_ID || undefined, key, keyId: APNS_KEY_ID, teamId: APNS_TEAM_ID };
};

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

/** APNs rejection reasons that mean the token will never work again. */
export const APNS_INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered']);

/** APNs asks providers to refresh the JWT between 20 and 60 minutes. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApnsRequest {
  body: string;
  headers: Record<string, string>;
  /** `https://api(.sandbox).push.apple.com` */
  origin: string;
  path: string;
}

export interface ApnsResponse {
  body: string;
  status: number;
}

/** Network seam so tests never open a real HTTP/2 connection. */
export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsResponse>;

export interface ApnsSendParams {
  environment: ApnsEnvironment;
  payload: Record<string, unknown>;
  token: string;
  /** Overrides the configured bundle id. */
  topic?: string;
}

export type ApnsSendResult =
  { status: 'ok' } | { reason: string; status: 'error'; statusCode: number };

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** One HTTP/2 session per APNs host, reconnected when it closes. */
export const createHttp2Transport = (): ApnsTransport => {
  const sessions = new Map<string, http2.ClientHttp2Session>();

  const session = (origin: string) => {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;

    const created = http2.connect(origin);
    const forget = () => {
      if (sessions.get(origin) === created) sessions.delete(origin);
    };
    created.on('close', forget);
    created.on('error', forget);
    created.on('goaway', forget);
    // Do not keep the process alive just for an idle push connection.
    created.unref();
    sessions.set(origin, created);
    return created;
  };

  return ({ body, headers, origin, path }) =>
    new Promise<ApnsResponse>((resolve, reject) => {
      const stream = session(origin).request({ ':method': 'POST', ':path': path, ...headers });
      let status = 0;
      let data = '';

      stream.setEncoding('utf8');
      stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error('APNs request timed out'));
      });
      stream.on('response', (responseHeaders) => {
        status = Number(responseHeaders[':status']);
      });
      stream.on('data', (chunk: string) => {
        data += chunk;
      });
      stream.on('end', () => resolve({ body: data, status }));
      stream.on('error', reject);
      stream.end(body);
    });
};

/**
 * Minimal APNs provider-API client: token-based auth (ES256 JWT signed with
 * the .p8 key), one `alert` push per device token.
 */
export class ApnsClient {
  private cachedToken?: { issuedAt: number; jwt: string };
  private readonly now: () => number;
  private readonly signingKey: KeyObject;
  private readonly transport: ApnsTransport;

  constructor(
    private readonly config: ApnsConfig,
    options: { now?: () => number; transport?: ApnsTransport } = {},
  ) {
    this.signingKey = createPrivateKey(config.key);
    this.transport = options.transport ?? createHttp2Transport();
    this.now = options.now ?? Date.now;
  }

  /** Builds a client from the environment, or `undefined` when APNs is not configured. */
  static fromEnv(options?: { transport?: ApnsTransport }): ApnsClient | undefined {
    const config = getApnsConfigFromEnv();
    return config ? new ApnsClient(config, options) : undefined;
  }

  get defaultTopic() {
    return this.config.bundleId;
  }

  /** The provider token, reused until it nears APNs' one-hour limit. */
  providerToken(refresh = false): string {
    const now = this.now();
    if (!refresh && this.cachedToken && now - this.cachedToken.issuedAt < TOKEN_TTL_MS)
      return this.cachedToken.jwt;

    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.config.keyId }));
    const claims = base64url(
      JSON.stringify({ iat: Math.floor(now / 1000), iss: this.config.teamId }),
    );
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
      dsaEncoding: 'ieee-p1363',
      key: this.signingKey,
    });
    const jwt = `${header}.${claims}.${base64url(signature)}`;
    this.cachedToken = { issuedAt: now, jwt };
    return jwt;
  }

  async send({ environment, payload, token, topic }: ApnsSendParams): Promise<ApnsSendResult> {
    const apnsTopic = topic ?? this.config.bundleId;
    if (!apnsTopic) return { reason: 'MissingTopic', status: 'error', statusCode: 0 };

    const request = (jwt: string): ApnsRequest => ({
      body: JSON.stringify(payload),
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        'apns-topic': apnsTopic,
        'authorization': `bearer ${jwt}`,
        'content-type': 'application/json',
      },
      origin: APNS_HOSTS[environment],
      path: `/3/device/${token}`,
    });

    let response = await this.transport(request(this.providerToken()));
    let reason = parseReason(response.body);
    // A provider token APNs considers stale is re-signed once.
    if (response.status === 403 && reason === 'ExpiredProviderToken') {
      response = await this.transport(request(this.providerToken(true)));
      reason = parseReason(response.body);
    }

    if (response.status === 200) return { status: 'ok' };
    return { reason: reason ?? 'unknown', status: 'error', statusCode: response.status };
  }
}

const parseReason = (body: string): string | undefined => {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : undefined;
  } catch {
    return undefined;
  }
};
