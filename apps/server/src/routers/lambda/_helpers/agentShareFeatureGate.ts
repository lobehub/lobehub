import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Shared shape of {@link assertAgentShareCreationEnabled} and
 * {@link assertAgentShareVisitorEnabled}: both check the same
 * `ENABLE_BUSINESS_FEATURES` compile-time gate, then the same
 * `enableAgentShare` feature flag, differing only in which error message to
 * use. Factored out so the two exports cannot drift.
 */
const createAgentShareGate =
  (flagKey: 'enableAgentShare', notEnabledMessage: string) => async (userId: string) => {
    if (!ENABLE_BUSINESS_FEATURES) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Agent sharing is not available on this deployment',
      });
    }

    const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
    if (featureFlags[flagKey] !== true) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: notEnabledMessage,
      });
    }
  };

/**
 * Availability gates for Agent Share. The feature has two capabilities —
 * CREATING a share (publishing) and VISITING one (opening/chatting on an
 * already-live share) — but a SINGLE rollout allowlist governs both: a user
 * matched by `agent_share` can publish and visit, everyone else can do
 * neither. Two exports remain only so each call site can raise the message
 * that fits its surface.
 *
 * Both gates are checked here on the server rather than only in the UI (the
 * gap topic-share has — its `ENABLE_BUSINESS_FEATURES` check is client-only,
 * so a self-hosted deployment can enable topic sharing by calling the API
 * directly), in two layers:
 *
 * 1. `ENABLE_BUSINESS_FEATURES` — compile-time business-slot constant, false
 *    in OSS builds. Self-hosted deployments cannot flip it with env vars, so
 *    agent sharing is structurally cloud-only end to end.
 * 2. The `enableAgentShare` feature flag — the grayscale whitelist (user IDs)
 *    published by admins, evaluated per user. It fails closed on
 *    anything other than `true` (including `undefined`, i.e. unconfigured),
 *    so a deployment must explicitly opt a user in.
 *
 * Deliberately NOT applied to `disableShare` / visibility→private, nor to any
 * other management mutation (`updateShareConfig`, `updateSlug`,
 * `getShareStatus`, `getShareStats`): a creator removed from the whitelist
 * must still be able to revoke and manage an existing share. Symmetrically,
 * `assertAgentShareVisitorEnabled` must never run for the share OWNER
 * previewing their own share — an owner who is later dropped from the
 * whitelist would otherwise lose access to their own live share. See the call
 * site in `share.ts`'s `getSharedAgent`, which only applies it to non-owner
 * viewers.
 */
export const assertAgentShareCreationEnabled = createAgentShareGate(
  'enableAgentShare',
  'Agent sharing is not enabled for this account',
);

export const assertAgentShareVisitorEnabled = createAgentShareGate(
  'enableAgentShare',
  'Shared agents are not available for this account',
);
