import { createHash, randomUUID } from 'node:crypto';

import { GENERIC_WEBHOOK_THREAD_KEY_MAX } from '@lobechat/types';

import type { DeliveryResult, InboundDeliveryRequest } from '../types';

/** Query parameters the receiver reads itself; they are not part of the payload. */
const RESERVED_QUERY = new Set(['thread']);
const MAX_EVENT_ID = 200;

/** Request headers worth handing the Agent: content shape, sender, and event-style `X-` headers. */
const SENSITIVE_HEADER =
  /auth|token|signature|secret|key|cookie|forwarded|session|csrf|(^|-)ip(-|$)/i;
const INFRA_HEADER =
  /^x-(vercel|amz|middleware|nextjs|real|cloud|cf|envoy|b3|datadog|request-start)/i;
export const pickHeaders = (headers: Headers): Record<string, string> => {
  const picked: Record<string, string> = {};
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    const keep =
      lower === 'content-type' ||
      lower === 'user-agent' ||
      (lower.startsWith('x-') && !SENSITIVE_HEADER.test(lower) && !INFRA_HEADER.test(lower));
    if (keep && lower !== 'x-thread-key') picked[lower] = value.slice(0, 500);
  }
  return picked;
};

/**
 * Repeated keys become arrays, so `?tag=a&tag=b` keeps both values. Keys are the caller's, so the
 * record has no prototype: `__proto__` or `constructor` is kept as a field like any other.
 */
const entriesToRecord = (entries: Iterable<[string, string]>, skip?: Set<string>) => {
  const record = Object.create(null) as Record<string, string | string[]>;
  for (const [key, value] of entries) {
    if (skip?.has(key)) continue;
    const previous = record[key];
    // Appended in place: copying the array on every repeat made a form of many repeated fields
    // quadratic to parse.
    if (previous === undefined) record[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else record[key] = [previous, value];
  }
  return record;
};

const looksLikeJson = (text: string) => /^\s*[[{]/.test(text);

/**
 * Whatever the caller sent, as the Agent will see it: JSON as JSON, a form as fields, anything else
 * as text. `curl -d` labels every body as a form, so a "form" that parses as JSON is read as JSON,
 * and one without any `key=value` pair is read as text.
 */
export const parseBody = (
  body: string,
  contentType: string,
): { ok: true; value: unknown } | { ok: false; status: 400 | 415; error: string } => {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type.startsWith('multipart/'))
    return {
      error: 'File uploads are not supported; send JSON, a form or text',
      ok: false,
      status: 415,
    };
  if (!body.trim()) return { ok: true, value: {} };
  const tryJson = () => {
    try {
      return { ok: true as const, value: JSON.parse(body) as unknown };
    } catch {
      return undefined;
    }
  };
  if (type === 'application/json' || type.endsWith('+json'))
    return tryJson() ?? { error: 'Invalid JSON', ok: false, status: 400 };
  if (looksLikeJson(body)) {
    const json = tryJson();
    if (json) return json;
  }
  // `curl -d 'some text'` also labels plain text as a form; without a single `=` it is not one.
  if (type === 'application/x-www-form-urlencoded' && body.includes('='))
    return { ok: true, value: entriesToRecord(new URLSearchParams(body)) };
  return { ok: true, value: body };
};

/** The caller's idempotency key, or a fresh id when it sent none (no deduplication then). */
const eventIdOf = (headers: Headers) => {
  const key =
    headers.get('idempotency-key') ?? headers.get('x-request-id') ?? headers.get('webhook-id');
  const trimmed = key?.trim();
  if (!trimmed) return randomUUID();
  return trimmed.length > MAX_EVENT_ID
    ? `sha256:${createHash('sha256').update(trimmed).digest('hex')}`
    : trimmed;
};

export const GENERIC_WEBHOOK_EVENT_NAME = 'webhook';

export function parseGenericDelivery(request: InboundDeliveryRequest): DeliveryResult {
  const threadKey = (
    request.query.get('thread') ??
    request.headers.get('x-thread-key') ??
    ''
  ).trim();
  if (threadKey.length > GENERIC_WEBHOOK_THREAD_KEY_MAX)
    return {
      response: { error: `Thread key longer than ${GENERIC_WEBHOOK_THREAD_KEY_MAX} characters` },
      status: 400,
    };
  const parsed = parseBody(request.body, request.headers.get('content-type') ?? '');
  if (!parsed.ok) return { response: { error: parsed.error }, status: parsed.status };
  const query = entriesToRecord(request.query, RESERVED_QUERY);
  return {
    event: {
      ...(threadKey ? { address: { threadKey } } : {}),
      data: {
        body: parsed.value,
        headers: pickHeaders(request.headers),
        ...(Object.keys(query).length ? { query } : {}),
      },
      eventId: eventIdOf(request.headers),
      ...(request.test ? { extra: { test: true } } : {}),
      name: GENERIC_WEBHOOK_EVENT_NAME,
      timestamp: new Date().toISOString(),
    },
  };
}
