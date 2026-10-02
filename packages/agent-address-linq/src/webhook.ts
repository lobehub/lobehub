import { createHmac, timingSafeEqual } from 'node:crypto';

import type { LinqWebhookEvent, LinqWebhookSignatureHeaders } from './types';

/**
 * Linq signs every webhook delivery with **Standard Webhooks**:
 *
 * ```
 * signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 * signature      = `v1,` + base64(HMAC-SHA256(secretKey, signed content))
 * ```
 *
 * `webhook-signature` may carry several space-separated entries (key
 * rotation); any `v1,<sig>` that matches verifies the delivery. Deliveries
 * older than five minutes are rejected, and comparison is constant-time.
 *
 * This module owns the messenger **webhook gate**: the same algorithm the
 * official `@linqapp/chat-sdk-adapter` runs through `standardwebhooks` for the
 * chat-SDK dispatch path, plus the two things that adapter does not do —
 * `webhook-id` de-duplication and gate-shaped status codes.
 * `webhook.test.ts` cross-checks this implementation against the official
 * verifier so the two cannot drift.
 */

/** Standard Webhooks tolerance — deliveries older than this are rejected. */
export const LINQ_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** How long a `webhook-id` stays claimed. Covers Linq's retry window. */
export const LINQ_WEBHOOK_ID_TTL_SECONDS = 10 * 60;

/** Standard Webhooks secrets are `whsec_<base64>`; the prefix is not key material. */
const SECRET_PREFIX = 'whsec_';

const decodeSecret = (secret: string): Buffer => {
  if (secret.startsWith(SECRET_PREFIX)) {
    return Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64');
  }
  // Not every deployment configures the `whsec_` form; the reference
  // implementation treats a bare string the same way (base64), so keep parity.
  return Buffer.from(secret, 'base64');
};

/**
 * Produce the `webhook-signature` value for a payload.
 *
 * Exported because it is the only way to build a realistic fixture: the mock
 * Linq server in the acceptance harness and the unit tests both sign with it,
 * so the verifier is exercised against the real algorithm rather than a
 * hard-coded digest.
 */
export const signLinqWebhookPayload = (params: {
  body: string;
  id: string;
  secret: string;
  timestamp: number | string;
}): string => {
  const signedContent = `${params.id}.${params.timestamp}.${params.body}`;
  const digest = createHmac('sha256', decodeSecret(params.secret))
    .update(signedContent)
    .digest('base64');
  return `v1,${digest}`;
};

export type LinqWebhookSignatureFailure =
  'invalid-signature' | 'missing-headers' | 'timestamp-out-of-tolerance';

export interface LinqWebhookSignatureOptions {
  /** Raw request body — the exact bytes the signature was computed over. */
  body: string;
  headers: LinqWebhookSignatureHeaders;
  /** Injectable clock, in milliseconds. Defaults to `Date.now()`. */
  now?: number;
  secret: string;
  toleranceSeconds?: number;
}

/**
 * Pure Standard Webhooks verification — no I/O, so it is directly testable and
 * reusable outside a `Request` (the smoke harness signs with
 * `signLinqWebhookPayload` and verifies with this).
 */
export const verifyLinqWebhookSignature = (
  options: LinqWebhookSignatureOptions,
): { ok: true } | { ok: false; reason: LinqWebhookSignatureFailure } => {
  const { body, headers, secret } = options;
  const { id, signature, timestamp } = headers;

  if (!id || !signature || !timestamp) return { ok: false, reason: 'missing-headers' };

  const tolerance = options.toleranceSeconds ?? LINQ_WEBHOOK_TOLERANCE_SECONDS;
  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds)) return { ok: false, reason: 'invalid-signature' };

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - sentAtSeconds) > tolerance) {
    return { ok: false, reason: 'timestamp-out-of-tolerance' };
  }

  const expected = signLinqWebhookPayload({ body, id, secret, timestamp }).split(',')[1];
  const expectedBytes = Buffer.from(expected);

  for (const entry of signature.split(' ')) {
    const [version, candidate] = entry.split(',');
    if (version !== 'v1' || !candidate) continue;

    const candidateBytes = Buffer.from(candidate);
    // Length check first: `timingSafeEqual` throws on a length mismatch, and a
    // mismatched length already proves the signature wrong.
    if (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'invalid-signature' };
};

// ---------------------------------------------------------------------------
// webhook-id de-duplication
// ---------------------------------------------------------------------------

/**
 * Claim store behind the deduplicator.
 *
 * `claim` must be atomic: return `true` exactly once per id, `false` for every
 * replay. In-process deployments get
 * `createInMemoryLinqWebhookDedupeStore`; a multi-instance deployment injects a
 * Redis-backed store (see the messenger platform's gate) so two webhook
 * workers cannot both accept the same delivery.
 */
export interface LinqWebhookDedupeStore {
  claim: (id: string, ttlSeconds: number) => Promise<boolean>;
}

export interface InMemoryLinqWebhookDedupeStoreOptions {
  /** Hard cap on tracked ids; oldest claims are evicted first. */
  maxEntries?: number;
  /** Injectable clock, in milliseconds. */
  now?: () => number;
}

/**
 * Bounded in-memory claim store.
 *
 * Webhook deliveries are bursty and short-lived, so a Map with lazy expiry and
 * an entry cap is enough for a single process and cannot grow without bound.
 */
export const createInMemoryLinqWebhookDedupeStore = (
  options: InMemoryLinqWebhookDedupeStoreOptions = {},
): LinqWebhookDedupeStore => {
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const claims = new Map<string, number>();

  return {
    async claim(id: string, ttlSeconds: number): Promise<boolean> {
      const current = now();
      const expiresAt = claims.get(id);
      if (expiresAt !== undefined && expiresAt > current) return false;

      // Opportunistic sweep: delivery rates are low enough that evicting on
      // claim keeps the map clean without a timer to leak.
      for (const [key, expiry] of claims) {
        if (expiry <= current) claims.delete(key);
      }

      while (claims.size >= maxEntries) {
        const oldest = claims.keys().next();
        if (oldest.done) break;
        claims.delete(oldest.value);
      }

      claims.set(id, current + ttlSeconds * 1000);
      return true;
    },
  };
};

/** Thin wrapper so callers read `isDuplicate(id)` instead of `!claim(id)`. */
export class LinqWebhookDeduplicator {
  constructor(
    private readonly store: LinqWebhookDedupeStore = createInMemoryLinqWebhookDedupeStore(),
    private readonly ttlSeconds: number = LINQ_WEBHOOK_ID_TTL_SECONDS,
  ) {}

  /** True when this `webhook-id` was already accepted (a Linq retry). */
  async isDuplicate(id: string): Promise<boolean> {
    return !(await this.store.claim(id, this.ttlSeconds));
  }
}

// ---------------------------------------------------------------------------
// Request-level gate
// ---------------------------------------------------------------------------

export type LinqWebhookGateResult =
  { event: LinqWebhookEvent; id: string; ok: true } | { ok: false; response: Response };

export interface LinqWebhookGateOptions {
  deduplicator?: LinqWebhookDeduplicator;
  now?: number;
  /** Raw body, when the caller already buffered it (otherwise it is read here). */
  rawBody?: string;
  signingSecret: string | undefined;
  toleranceSeconds?: number;
}

/**
 * Verify + de-duplicate one Linq webhook delivery.
 *
 * Order matters: signature first (never let an unauthenticated body touch the
 * dedupe store, or an attacker can burn ids and suppress real deliveries),
 * then the replay check.
 */
export const verifyLinqWebhookRequest = async (
  request: Request,
  options: LinqWebhookGateOptions,
): Promise<LinqWebhookGateResult> => {
  const { deduplicator, signingSecret } = options;

  if (!signingSecret) {
    return {
      ok: false,
      response: new Response('Linq webhook signing secret is not configured', { status: 503 }),
    };
  }

  const body = options.rawBody ?? (await request.text());
  const headers: LinqWebhookSignatureHeaders = {
    id: request.headers.get('webhook-id') ?? '',
    signature: request.headers.get('webhook-signature') ?? '',
    timestamp: request.headers.get('webhook-timestamp') ?? '',
  };

  const verified = verifyLinqWebhookSignature({
    body,
    headers,
    now: options.now,
    secret: signingSecret,
    toleranceSeconds: options.toleranceSeconds,
  });
  if (!verified.ok) {
    return {
      ok: false,
      response: new Response(`Invalid Linq webhook (${verified.reason})`, { status: 401 }),
    };
  }

  if (deduplicator && (await deduplicator.isDuplicate(headers.id))) {
    // 409, not 200: Linq stops retrying once it sees a definitive answer, and a
    // replay is a duplicate delivery — never a second inbound message.
    return { ok: false, response: new Response('Duplicate Linq webhook', { status: 409 }) };
  }

  let event: LinqWebhookEvent;
  try {
    event = JSON.parse(body) as LinqWebhookEvent;
  } catch {
    return { ok: false, response: new Response('Invalid JSON', { status: 400 }) };
  }

  if (!event || typeof event !== 'object' || typeof event.event_type !== 'string') {
    return { ok: false, response: new Response('Invalid Linq event', { status: 400 }) };
  }

  return { event, id: headers.id, ok: true };
};
