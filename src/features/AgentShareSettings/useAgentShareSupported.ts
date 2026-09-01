'use client';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { featureFlagsSelectors } from '@/store/serverConfig/selectors';

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
 * `supported` is intentionally structural only: `enableAgentShare` must NOT
 * gate it. The flag is a rollout gate on *publishing*, and the server keeps
 * disable / updateConfig / updateSlug / getShareStatus open when it is off — so
 * hiding the whole surface would strand an owner who was rolled back out of the
 * allowlist with a live share they can no longer revoke. Publishing is gated
 * through `publishable` instead, where `undefined` (flags unresolved) stays
 * permissive to match the schema default.
 */
export const useAgentShareSupported = (agentId?: string | null): AgentShareSupport => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const isBuiltinAgent = useAgentStore(builtinAgentSelectors.isBuiltinAgent(agentId ?? undefined));
  const enableAgentShare = useServerConfigStore(featureFlagsSelectors).enableAgentShare;

  const supported = !!agentId && !hasActiveWorkspace && !isBuiltinAgent;

  return { publishable: supported && enableAgentShare !== false, supported };
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
