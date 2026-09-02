import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Availability gates for Agent Share, split into the two independent
 * capabilities the feature actually has — CREATING a share (publishing) and
 * VISITING one (opening/chatting on an already-live share). Both share the
 * same two-layer shape, checked here on the server rather than only in the
 * UI (the gap topic-share has — its `ENABLE_BUSINESS_FEATURES` check is
 * client-only, so a self-hosted deployment can enable topic sharing by
 * calling the API directly):
 *
 * 1. `ENABLE_BUSINESS_FEATURES` — compile-time business-slot constant, false
 *    in OSS builds. Self-hosted deployments cannot flip it with env vars, so
 *    agent sharing is structurally cloud-only end to end.
 * 2. A per-capability feature flag (`enableAgentShare` /
 *    `enableAgentShareVisitor`) — the grayscale whitelist (user IDs or
 *    emails) published by admins, evaluated per user. Both fail closed on
 *    anything other than `true` (including `undefined`, i.e. unconfigured),
 *    so a deployment must explicitly opt a user in.
 *
 * Deliberately NOT applied to `disableShare` / visibility→private, nor to any
 * other management mutation (`updateShareConfig`, `updateSlug`,
 * `getShareStatus`, `getShareStats`): a creator removed from the whitelist
 * must still be able to revoke and manage an existing share. Symmetrically,
 * `assertAgentShareVisitorEnabled` must never run for the share OWNER
 * previewing their own share — see the call site in `share.ts`'s
 * `getSharedAgent`, which only applies it to non-owner viewers.
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
      message: 'Agent sharing is not enabled for this account',
    });
  }
};

export const assertAgentShareVisitorEnabled = async (userId: string) => {
  if (!ENABLE_BUSINESS_FEATURES) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Agent sharing is not available on this deployment',
    });
  }

  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (featureFlags.enableAgentShareVisitor !== true) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Shared agents are not available for this account',
    });
  }
};
