import { TRPCError } from '@trpc/server';

/** The indexes that make a name identify one environment for one member. */
const ENVIRONMENT_NAME_CONSTRAINTS = new Set([
  'environments_user_name_unique',
  'environments_workspace_user_name_unique',
]);

/** Postgres surfaces the driver error somewhere down the `cause` chain. */
export const getPostgresErrorField = (error: unknown, field: string): string | undefined => {
  let current: unknown = error;

  while (current && typeof current === 'object') {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;

    current = (current as { cause?: unknown }).cause;
  }
};

/**
 * The name is the one thing the person chose, and a collision is fixed by
 * typing a different one — so it has to arrive as CONFLICT next to the field,
 * not as the generic failure a raw driver error would produce. A code rather
 * than prose because this one is shown inline and has to be translated.
 */
export const rethrowDuplicateEnvironmentName = (error: unknown): never => {
  if (
    getPostgresErrorField(error, 'code') === '23505' &&
    ENVIRONMENT_NAME_CONSTRAINTS.has(getPostgresErrorField(error, 'constraint') ?? '')
  ) {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: 'DUPLICATE_ENVIRONMENT_NAME' });
  }

  throw error;
};

/**
 * An environment with instances still on it. The reference is `restrict`
 * on purpose — deleting the specification out from under them would leave
 * directories and captured state nothing describes.
 */
export const rethrowEnvironmentInUse = (error: unknown): never => {
  if (getPostgresErrorField(error, 'code') === '23503') {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: 'ENVIRONMENT_HAS_INSTANCES' });
  }

  throw error;
};
