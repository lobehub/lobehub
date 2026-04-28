import type { Context } from 'hono';

export class MarketHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketHttpError';
  }
}

export const jsonError = (c: Context, status: number, code: string, message: string) =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as never,
  );

export const notImplemented = (c: Context, endpoint: string) =>
  jsonError(
    c,
    501,
    'not_implemented',
    `${endpoint} is not implemented in the internal Market v1 service.`,
  );
