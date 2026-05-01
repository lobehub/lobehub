import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class MarketHttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketHttpError';
  }
}

export const jsonError = (
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    status,
  );

export const notImplemented = (c: Context, endpoint: string) =>
  jsonError(
    c,
    501,
    'not_implemented',
    `${endpoint} is not implemented in the internal Market v1 service.`,
  );
