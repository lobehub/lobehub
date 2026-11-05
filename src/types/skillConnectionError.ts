/**
 * Machine-readable discriminator for a LobeHub Skill provider whose connection
 * is missing or expired. Sent as the tRPC error's `cause.data.code` (surfaced
 * to clients as `error.data.errorData.code`) next to `PRECONDITION_FAILED`.
 *
 * Deliberately not `UNAUTHORIZED`: that code drives the LobeHub / Market
 * re-login flows, and a provider connection is neither.
 */
export const SkillConnectionErrorCode = {
  NotConnected: 'NOT_CONNECTED',
  TokenExpired: 'TOKEN_EXPIRED',
} as const;

export type SkillConnectionErrorCode =
  (typeof SkillConnectionErrorCode)[keyof typeof SkillConnectionErrorCode];

/** Whether a tRPC client error carries a provider-connection discriminator. */
export const isSkillConnectionError = (error: unknown): boolean => {
  const data = (error as { data?: { code?: unknown; errorData?: { code?: unknown } } } | null)
    ?.data;
  return (
    data?.code === 'PRECONDITION_FAILED' &&
    Object.values<unknown>(SkillConnectionErrorCode).includes(data.errorData?.code)
  );
};
