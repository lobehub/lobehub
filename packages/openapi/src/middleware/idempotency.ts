import { createHash } from 'node:crypto';

import type { Context, Next } from 'hono';

import { redisService } from '@/server/services/redis';

import { renderApiError } from '../common/errors';
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

const replay = (c: Context, record: IdempotentResponseRecord) => {
  const headers = new Headers({ [IDEMPOTENT_REPLAYED_HEADER]: 'true' });
  if (record.contentType) headers.set('Content-Type', record.contentType);
  return c.body(record.body, record.status as never, Object.fromEntries(headers));
};

/**
 * Who a stored response belongs to, beyond the user: the credential that sent
 * the request and the workspace it resolved to. This middleware runs before
 * route guards, so a replay must never cross either — another (possibly
 * scope-restricted) API key of the same user, or the same key in another
 * workspace, gets its own key space instead of the first caller's response.
 */
const principalOf = (c: Context) => {
  const apiKeyId = (c.get('authData') as { apiKeyId?: number | string } | null)?.apiKeyId;
  return [c.get('authType') ?? '', apiKeyId ?? '', c.get('workspaceId') ?? ''].join(':');
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
          body: await c.res.clone().text(),
          contentType: c.res.headers.get('Content-Type'),
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
