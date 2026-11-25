import { createHash } from 'node:crypto';

import type { Context, Next } from 'hono';

import { redisService } from '@/server/services/redis';

import { getRequestId, renderApiError } from '../common/errors';
import { logFailOpen } from '../helpers/fail-open-log';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
/** Set on a response replayed from the stored first result of its key. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

const MAX_KEY_LENGTH = 255;

type IdempotentResponseRecord = Parameters<typeof redisService.openapi.completeIdempotency>[1];

const sha256 = (value: string | ArrayBuffer) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : Buffer.from(value))
    .digest('hex');

/**
 * Only answers a client would want replayed are stored: server errors and
 * rate-limit refusals stay retryable, and a stream cannot be replayed.
 */
const isReplayable = (response: Response) => {
  const contentType = response.headers.get('Content-Type') ?? '';
  return (
    response.status < 500 &&
    response.status !== 429 &&
    !contentType.includes('text/event-stream') &&
    response.body !== null
  );
};

/**
 * Responses are stored as base64 so that binary answers (`POST /audio/speech`
 * returns MP3/AAC/Opus bytes) replay byte for byte instead of being decoded and
 * re-encoded as UTF-8 text, which replaces invalid sequences.
 */
const encodeBody = async (response: Response) =>
  Buffer.from(await response.arrayBuffer()).toString('base64');

const decodeBody = (record: IdempotentResponseRecord) => {
  // Records written before responses were stored as base64 stay readable.
  if (record.encoding !== 'base64') return record.body;
  // `Uint8Array.from` copies out of Node's pooled Buffer, so the whole array
  // buffer belongs to this response.
  return Uint8Array.from(Buffer.from(record.body, 'base64')).buffer;
};

/**
 * A stored refusal carries the first request's `requestId`, while
 * `requestIdMiddleware` stamps the retry's own id on `X-Request-Id`. Header and
 * body would then name different requests, so the replayed error takes the
 * current id: the cached outcome (status, code, message) is unchanged, only the
 * correlation id belongs to the caller asking now.
 */
const withCurrentRequestId = (
  c: Context,
  record: IdempotentResponseRecord,
  body: string | ArrayBuffer,
): string | ArrayBuffer => {
  if (record.status < 400) return body;
  if (!(record.contentType ?? '').includes('application/json')) return body;

  try {
    const parsed: unknown = JSON.parse(
      typeof body === 'string' ? body : new TextDecoder().decode(body),
    );
    if (typeof parsed !== 'object' || parsed === null) return body;

    const error = parsed as { requestId?: unknown };
    if (typeof error.requestId !== 'string') return body;

    error.requestId = getRequestId(c);
    return new TextEncoder().encode(JSON.stringify(error)).buffer as ArrayBuffer;
  } catch {
    // A 4xx that is not JSON, or no longer parseable, replays untouched.
    return body;
  }
};

const replay = (c: Context, record: IdempotentResponseRecord) => {
  const headers = new Headers({ [IDEMPOTENT_REPLAYED_HEADER]: 'true' });
  if (record.contentType) headers.set('Content-Type', record.contentType);
  return c.body(
    withCurrentRequestId(c, record, decodeBody(record)) as never,
    record.status as never,
    Object.fromEntries(headers),
  );
};

/**
 * The authorization a request carried. Narrowing a credential's scopes is an
 * authorization change, and this middleware runs before route guards, so the
 * snapshot is part of who a stored response belongs to: a key restricted after
 * its first request must not be answered from that key's earlier, privileged
 * result — it gets its own key space and runs through the guards instead.
 */
const authorizationOf = (c: Context) => {
  const scopes = c.get('apiKeyScopes') as string[] | null | undefined;
  // `undefined` = not API-key auth, where the token's own grants bound it.
  if (scopes === undefined) return 'token';
  // `null` = full-access key, which is not the same key space as any scope set.
  return scopes === null ? 'all' : JSON.stringify([...scopes].sort());
};

/**
 * Who a stored response belongs to, beyond the user: the credential that sent
 * the request, the workspace it resolved to, and the authorization it carried.
 * This middleware runs before route guards, so a replay must never cross any of
 * them — another (possibly scope-restricted) API key of the same user, the same
 * key in another workspace, the same key after its scopes were narrowed, or the
 * same key after the caller's workspace role changed, each gets its own key
 * space instead of the first caller's response.
 */
const principalOf = (c: Context) => {
  const apiKeyId = (c.get('authData') as { apiKeyId?: number | string } | null)?.apiKeyId;
  return [
    c.get('authType') ?? '',
    apiKeyId ?? '',
    c.get('workspaceId') ?? '',
    // The role is authorization too: the route guards that read it run after
    // this middleware, so an administrator demoted to member must not keep
    // replaying the privileged answer cached while they still held the role.
    c.get('workspaceRole') ?? '',
    authorizationOf(c),
  ].join(':');
};

/**
 * `Idempotency-Key` support for POST: the first request with a key runs and
 * its response is stored for 24 hours (in Redis through `redisService.openapi`,
 * scoped to the user, credential and workspace); a retry with the same key and
 * the same request gets that response back with `Idempotent-Replayed: true`
 * instead of running again. A retry while the first is still running answers
 * 409, and reusing a key for a different request (method, path or body)
 * answers 422 — both `idempotency_conflict`. Requests without the header are
 * untouched.
 */
export const idempotencyMiddleware = async (c: Context, next: Next) => {
  const clientKey = c.req.header(IDEMPOTENCY_KEY_HEADER);
  const userId = c.get('userId') as string | null | undefined;
  if (c.req.method !== 'POST' || clientKey === undefined || !userId) return next();

  if (!clientKey.trim() || clientKey.length > MAX_KEY_LENGTH) {
    return renderApiError(c, {
      code: 'validation_error',
      details: [
        {
          message: `Must be 1–${MAX_KEY_LENGTH} characters`,
          path: `header.${IDEMPOTENCY_KEY_HEADER}`,
        },
      ],
      message: `Invalid request: ${IDEMPOTENCY_KEY_HEADER} must be 1–${MAX_KEY_LENGTH} characters`,
      status: 400,
    });
  }

  const url = new URL(c.req.url);
  const body = await c.req.raw.clone().arrayBuffer();
  const scope = {
    fingerprint: sha256([c.req.method, url.pathname + url.search, sha256(body)].join('\n')),
    keyHash: sha256(`${principalOf(c)}\n${clientKey}`),
    userId,
  };

  const claim = await redisService.openapi.claimIdempotency(scope).catch((error) => {
    logFailOpen('idempotency', error);
    return undefined;
  });
  if (!claim) return next();

  if (claim.state !== 'claimed') {
    if (!claim.sameRequest) {
      return renderApiError(c, {
        code: 'idempotency_conflict',
        message: `This ${IDEMPOTENCY_KEY_HEADER} was already used for a different request`,
        status: 422,
      });
    }
    if (claim.state === 'pending') {
      return renderApiError(c, {
        code: 'idempotency_conflict',
        message: `A request with this ${IDEMPOTENCY_KEY_HEADER} is still in progress; retry later`,
        status: 409,
      });
    }
    return replay(c, claim.response);
  }

  const owned = { ...scope, token: claim.token };
  let stored = false;
  try {
    await next();

    if (isReplayable(c.res)) {
      // The handler already ran: a failed write must not turn its answer into an error.
      stored = await redisService.openapi
        .completeIdempotency(owned, {
          body: await encodeBody(c.res.clone()),
          contentType: c.res.headers.get('Content-Type'),
          encoding: 'base64',
          status: c.res.status,
        })
        .then(() => true)
        .catch((error) => {
          console.error('[openapi] failed to store idempotent response:', error);
          return false;
        });
    }
  } finally {
    if (!stored) {
      await redisService.openapi.releaseIdempotency(owned).catch((error) => {
        console.error('[openapi] failed to release idempotency claim:', error);
      });
    }
  }
};
