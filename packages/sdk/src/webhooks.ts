import type { WebhookEvent } from './generated/types.gen';

/**
 * Receiving LobeHub webhooks: check a delivery's signature and parse its body.
 *
 * Every delivery is signed with the endpoint's secret (`whsec_…`, returned once
 * by `webhooks.create` / `webhooks.rotateSecret`):
 * `X-LobeHub-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`,
 * where `<timestamp>` is the `X-LobeHub-Timestamp` header (Unix seconds).
 *
 * Uses Web Crypto, so it runs on Node ≥ 18, Bun, Deno, edge runtimes and browsers.
 */

/** Delivery request headers. Lookups here are case-insensitive. */
export const WEBHOOK_HEADERS = {
  deliveryId: 'X-LobeHub-Delivery-Id',
  eventId: 'X-LobeHub-Event-Id',
  eventType: 'X-LobeHub-Event-Type',
  signature: 'X-LobeHub-Signature',
  timestamp: 'X-LobeHub-Timestamp',
} as const;

/** Default replay window, in seconds, either side of the current time. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/** Every event type you can subscribe an endpoint to. */
export type WebhookEventType = Exclude<WebhookEvent['type'], 'webhook.test'>;

/** Every `type` a delivery can carry: the subscribable events plus `webhook.test`. */
export type WebhookDeliveryEventType = WebhookEvent['type'];

/** The delivery body of one event type, e.g. `WebhookEventOf<'run.completed'>`. */
export type WebhookEventOf<T extends WebhookDeliveryEventType> = Extract<WebhookEvent, { type: T }>;

/** The `data` of one event type, e.g. `WebhookEventData<'run.completed'>`. */
export type WebhookEventData<T extends WebhookDeliveryEventType> = WebhookEventOf<T>['data'];

export const WEBHOOK_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.intervention_requested',
  'message.created',
  'topic.created',
  'task.status_changed',
  'goal.status_changed',
  'file.parsed',
  'notification.created',
] as const satisfies readonly WebhookEventType[];

// Fails to compile when the API gains an event type this list does not name.
type MissingEventTypes = Exclude<WebhookEventType, (typeof WEBHOOK_EVENT_TYPES)[number]>;
const assertAllEventTypesListed: [MissingEventTypes] extends [never] ? true : MissingEventTypes =
  true;
void assertAllEventTypesListed;

export type WebhookSignatureErrorCode =
  | 'invalid_payload'
  | 'missing_signature'
  | 'missing_timestamp'
  | 'signature_mismatch'
  | 'timestamp_out_of_range'
  | 'webcrypto_unavailable';

export class WebhookSignatureVerificationError extends Error {
  readonly code: WebhookSignatureErrorCode;

  constructor(code: WebhookSignatureErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WebhookSignatureVerificationError';
  }
}

/**
 * Request headers in any common shape: a Fetch `Headers`, or a plain object such
 * as Node's `IncomingHttpHeaders` (lower-cased keys, values possibly arrays).
 */
export type WebhookHeaders =
  Headers | Record<string, string | readonly string[] | null | undefined>;

export interface VerifyWebhookSignatureOptions {
  /** Request headers; `signature` / `timestamp` below take precedence when given. */
  headers?: WebhookHeaders;
  /** Current time; defaults to `new Date()`. */
  now?: Date;
  /** The raw request body, exactly as received. Re-serialised JSON will not verify. */
  payload: string | Uint8Array;
  /** The endpoint's signing secret (`whsec_…`). */
  secret: string;
  /** The `X-LobeHub-Signature` value. */
  signature?: string | null;
  /** The `X-LobeHub-Timestamp` value (Unix seconds). */
  timestamp?: string | number | null;
  /** Accepted clock difference in seconds, either way. Defaults to 300. */
  toleranceSeconds?: number;
}

const readHeader = (headers: WebhookHeaders | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function')
    return (headers as Headers).get(name) ?? undefined;

  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== wanted || value == null) continue;
    return Array.isArray(value) ? value.join(',') : String(value);
  }
  return undefined;
};

type SubtleCryptoLike = Pick<SubtleCrypto, 'importKey' | 'sign'>;

const getSubtle = async (): Promise<SubtleCryptoLike> => {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle;
  // Node 18 keeps Web Crypto off the global scope. Imported through a variable
  // so bundlers for other runtimes leave it alone.
  try {
    const cryptoModule = 'node:crypto';
    const { webcrypto } = (await import(/* @vite-ignore */ cryptoModule)) as {
      webcrypto?: { subtle?: SubtleCryptoLike };
    };
    if (webcrypto?.subtle) return webcrypto.subtle;
  } catch {
    // fall through
  }
  throw new WebhookSignatureVerificationError(
    'webcrypto_unavailable',
    'Web Crypto (crypto.subtle) is not available in this runtime',
  );
};

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Compare two strings without returning early on the first difference. */
const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** `v1=<hex>` values in a signature header; several may be separated by commas or spaces. */
const signatureCandidates = (header: string) =>
  header
    .split(/[\s,]+/)
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3).toLowerCase());

const concatBytes = (head: Uint8Array, tail: Uint8Array) => {
  const bytes = new Uint8Array(head.length + tail.length);
  bytes.set(head);
  bytes.set(tail, head.length);
  return bytes;
};

/**
 * Check that a delivery came from LobeHub and is fresh. Resolves when it does;
 * rejects with a {@link WebhookSignatureVerificationError} (see its `code`) when
 * the signature or timestamp is missing, the timestamp is outside
 * `toleranceSeconds` of `now`, or no `v1=` signature matches.
 *
 * @example
 * ```ts
 * await verifyWebhookSignature({ headers: request.headers, payload: rawBody, secret });
 * ```
 */
export const verifyWebhookSignature = async ({
  headers,
  now = new Date(),
  payload,
  secret,
  signature,
  timestamp,
  toleranceSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
}: VerifyWebhookSignatureOptions): Promise<void> => {
  const signatureHeader = signature ?? readHeader(headers, WEBHOOK_HEADERS.signature);
  const timestampValue = String(timestamp ?? readHeader(headers, WEBHOOK_HEADERS.timestamp) ?? '');

  if (!signatureHeader)
    throw new WebhookSignatureVerificationError(
      'missing_signature',
      `Missing ${WEBHOOK_HEADERS.signature} header`,
    );
  if (!/^\d+$/.test(timestampValue.trim()))
    throw new WebhookSignatureVerificationError(
      'missing_timestamp',
      `Missing or invalid ${WEBHOOK_HEADERS.timestamp} header`,
    );

  const signedAt = Number(timestampValue.trim());
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - signedAt) > toleranceSeconds)
    throw new WebhookSignatureVerificationError(
      'timestamp_out_of_range',
      `Timestamp is more than ${toleranceSeconds}s from the current time`,
    );

  const candidates = signatureCandidates(signatureHeader);
  if (candidates.length === 0)
    throw new WebhookSignatureVerificationError(
      'missing_signature',
      `No v1 signature in ${WEBHOOK_HEADERS.signature}`,
    );

  const subtle = await getSubtle();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const body = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const signed = concatBytes(encoder.encode(`${signedAt}.`), body);
  const expected = toHex(await subtle.sign('HMAC', key, signed));

  // Check every candidate so the time taken does not reveal which one matched.
  let matched = false;
  for (const candidate of candidates) matched = timingSafeEqual(candidate, expected) || matched;
  if (!matched)
    throw new WebhookSignatureVerificationError(
      'signature_mismatch',
      'Signature does not match the payload',
    );
};

/**
 * Verify a delivery (see {@link verifyWebhookSignature}), then parse its body
 * into a typed {@link WebhookEvent}. Narrow on `event.type`:
 *
 * @example
 * ```ts
 * const event = await constructWebhookEvent({ headers: request.headers, payload: rawBody, secret });
 * if (event.type === 'run.completed') console.log(event.data.runId);
 * ```
 */
export const constructWebhookEvent = async (
  options: VerifyWebhookSignatureOptions,
): Promise<WebhookEvent> => {
  await verifyWebhookSignature(options);
  const text =
    typeof options.payload === 'string'
      ? options.payload
      : new TextDecoder().decode(options.payload);
  try {
    return JSON.parse(text) as WebhookEvent;
  } catch {
    throw new WebhookSignatureVerificationError('invalid_payload', 'Payload is not valid JSON');
  }
};
