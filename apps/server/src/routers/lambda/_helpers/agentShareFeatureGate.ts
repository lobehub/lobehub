import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Existing shares remain accessible regardless of a visitor's rollout flags.
 * Deployment support is still enforced before resolving any shared data.
 */
export const assertAgentShareVisitorEnabled = () => {
  if (!ENABLE_BUSINESS_FEATURES) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Agent sharing is not available on this deployment',
    });
  }
};

/**
 * Only publishing or re-enabling a share requires the creator's explicit opt-in.
 * Managing, revoking, and previewing existing shares remain available when the
 * creator is removed from the rollout, as does visitor access.
 */
export const assertAgentShareCreationEnabled = async (userId: string) => {
  assertAgentShareVisitorEnabled();

  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (featureFlags.enableAgentShare !== true) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Agent sharing is not enabled for this account',
    });
  }
};
