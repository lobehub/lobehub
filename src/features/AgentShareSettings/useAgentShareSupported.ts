'use client';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { featureFlagsSelectors, serverConfigSelectors } from '@/store/serverConfig/selectors';

export interface AgentShareSupport {
  /**
   * Whether a *new* share may be published right now. Mirrors the server gate
   * on `agentShare.enableShare` / `updateVisibility → 'link'`; every other
   * mutation (disable, config, slug) stays open server-side on purpose.
   */
  publishable: boolean;
  /** Whether the share management surface applies to this agent at all. */
  supported: boolean;
}

/**
 * Whether this agent can be shared as a public link at all — the capability
 * half of the gate only, deliberately excluding the caller's edit permission so
 * every entry point (header action, tab switcher, the page itself) can combine
 * it with the `canConfigure` check it already computes.
 *
 * Agent sharing is personal-only — `agentShares` rows can never exist for a
 * workspace agent (see `AgentShareModel`'s ownership check) — and a builtin row
 * (Inbox, the builders) is not the owner's to hand out.
 *
 * `supported` additionally requires `enableBusinessFeatures`: a self-hosted
 * (OSS) deployment has no Agent Share surface at all — it is structurally
 * blocked server-side by `ENABLE_BUSINESS_FEATURES`
 * (`_helpers/agentShareFeatureGate.ts`), so hiding the whole management
 * surface there is not the same trade-off as gating on `enableAgentShare`
 * below. `enableAgentShare` (the CLOUD grayscale rollout flag) deliberately
 * does NOT narrow `supported`: the server keeps disable / updateConfig /
 * updateSlug / getShareStatus open when that flag is off, so hiding the
 * surface on it would strand an owner rolled back out of the allowlist with a
 * live share they can no longer revoke. Publishing is gated through
 * `publishable` instead, which fails closed on anything other than `true`
 * (including `undefined` / unresolved), mirroring the server's
 * `assertAgentShareCreationEnabled`.
 */
export const useAgentShareSupported = (agentId?: string | null): AgentShareSupport => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const isBuiltinAgent = useAgentStore(builtinAgentSelectors.isBuiltinAgent(agentId ?? undefined));
  const enableAgentShare = useServerConfigStore(featureFlagsSelectors).enableAgentShare;
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const supported = !!agentId && !hasActiveWorkspace && !isBuiltinAgent && enableBusinessFeatures;

  return { publishable: supported && enableAgentShare === true, supported };
};

/**
 * How the link on/off switch behaves under the publish gate.
 *
 * Only *publishing* is blocked: a share that is already live must stay
 * togglable so its owner can revoke it after losing the capability (the server
 * keeps `agentShare.disable` open for exactly that case).
 */
export const resolveLinkToggleState = ({
  isShared,
  publishable,
}: {
  isShared: boolean;
  publishable: boolean;
}) => {
  const publishBlocked = !publishable && !isShared;

  return {
    /** Blocks the `off → on` direction, never `on → off`. */
    canPublish: !publishBlocked,
    disabled: publishBlocked,
    offHintKey: publishBlocked
      ? ('share.settings.link.publishDisabled' as const)
      : ('share.settings.link.offHint' as const),
  };
};
