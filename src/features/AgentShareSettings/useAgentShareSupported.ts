'use client';

import useSWR from 'swr';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';
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
  /**
   * Whether the share entry (profile tab, header action, settings page) should
   * be shown to this account: `true` when it may publish OR already has a live
   * share to revoke, `false` when neither, `undefined` while the live-share
   * lookup for a non-publishable account is still resolving.
   */
  visible: boolean | undefined;
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
 * (`_helpers/agentShareFeatureGate.ts`).
 *
 * `enableAgentShare` (the CLOUD grayscale rollout flag) does NOT narrow
 * `supported` either: the server keeps disable / updateConfig / updateSlug /
 * getShareStatus open when that flag is off, so an owner rolled back out of
 * the allowlist with a live share must still be able to revoke it. Instead the
 * flag drives two derived values — `publishable` (fails closed on anything
 * other than `true`, mirroring the server's `assertAgentShareCreationEnabled`)
 * and `visible` (publishable, or a live share to revoke) — so an account
 * outside the allowlist with nothing live sees no share entry at all.
 */
export const useAgentShareSupported = (agentId?: string | null): AgentShareSupport => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const isBuiltinAgent = useAgentStore(builtinAgentSelectors.isBuiltinAgent(agentId ?? undefined));
  const enableAgentShare = useServerConfigStore(featureFlagsSelectors).enableAgentShare;
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const supported = !!agentId && !hasActiveWorkspace && !isBuiltinAgent && enableBusinessFeatures;
  const publishable = supported && enableAgentShare === true;

  // Outside the rollout allowlist the entry is hidden entirely — unless a live
  // share already exists, which the owner must still be able to reach and
  // revoke. The status lookup only runs for that non-publishable case, so the
  // allowlisted majority pays nothing extra here.
  const { data: share } = useSWR(
    supported && !publishable && agentId ? shareKeys.agentShareStatus(agentId) : null,
    () => agentShareService.getShareStatus(agentId!),
    { revalidateOnFocus: false },
  );

  let visible: boolean | undefined;
  if (!supported) visible = false;
  else if (publishable) visible = true;
  else if (share !== undefined) visible = share?.visibility === 'link';

  return { publishable, supported, visible };
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
