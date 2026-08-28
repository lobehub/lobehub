import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Availability gate for CREATING/GROWING agent shares.
 *
 * Two layers, checked here on the server rather than only in the UI (the gap
 * topic-share has — its `ENABLE_BUSINESS_FEATURES` check is client-only, so a
 * self-hosted deployment can enable topic sharing by calling the API
 * directly):
 *
 * 1. `ENABLE_BUSINESS_FEATURES` — compile-time business-slot constant, false
 *    in OSS builds. Self-hosted deployments cannot flip it with env vars, so
 *    agent sharing is structurally cloud-only.
 * 2. `enableAgentShare` feature flag — the grayscale whitelist (user IDs or
 *    emails) published by admins, evaluated per user. Defaults to false, so
 *    even on Cloud the feature stays dark until a rollout is published.
 *
 * Deliberately NOT applied to `disableShare` / visibility→private / visitor
 * procedures: a creator removed from the whitelist must still be able to
 * revoke an existing share, and visitors of a whitelisted creator's live
 * share are admitted by the share row itself, not the creator's flag.
 */
export const assertAgentShareCreationEnabled = async (userId: string) => {
  if (!ENABLE_BUSINESS_FEATURES) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Agent sharing is not available on this deployment',
    });
  }

  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (featureFlags.enableAgentShare !== true) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Agent sharing is not enabled for this user',
    });
  }
};
