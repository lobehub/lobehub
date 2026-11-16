import type { Context } from 'hono';

import type { ReviewEnv } from './auth';
import { reviewError } from './errors';

interface BodySchema<T> {
  safeParse: (
    value: unknown,
  ) => { data: T; success: true } | { error: { issues: { message: string }[] }; success: false };
}

export const parseBody = async <T>(
  c: Context<ReviewEnv>,
  schema: BodySchema<T>,
): Promise<{ data: T; error?: undefined } | { data?: undefined; error: Response }> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (parsed.success) return { data: parsed.data };
  return {
    error: reviewError(c, 400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Invalid input'),
  };
};
