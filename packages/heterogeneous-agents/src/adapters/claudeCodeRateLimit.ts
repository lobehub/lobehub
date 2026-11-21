import type { HeterogeneousRateLimitInfo } from '../types';

export const toRateLimitInfo = (value: unknown): HeterogeneousRateLimitInfo | undefined => {
  if (!value || typeof value !== 'object') return;

  const raw = value as Record<string, unknown>;

  return {
    isUsingOverage: typeof raw.isUsingOverage === 'boolean' ? raw.isUsingOverage : undefined,
    overageDisabledReason:
      typeof raw.overageDisabledReason === 'string' ? raw.overageDisabledReason : undefined,
    overageStatus: typeof raw.overageStatus === 'string' ? raw.overageStatus : undefined,
    rateLimitType: typeof raw.rateLimitType === 'string' ? raw.rateLimitType : undefined,
    resetsAt: typeof raw.resetsAt === 'number' ? raw.resetsAt : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  };
};
