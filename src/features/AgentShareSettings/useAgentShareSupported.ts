'use client';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { featureFlagsSelectors } from '@/store/serverConfig/selectors';

/**
 * Whether this agent can be shared as a public link at all — the capability
 * half of the gate only, deliberately excluding the caller's edit permission so
 * every entry point (header action, tab switcher, the page itself) can combine
 * it with the `canConfigure` check it already computes.
 *
 * Agent sharing is personal-only — `agentShares` rows can never exist for a
 * workspace agent (see `AgentShareModel`'s ownership check) — and a builtin row
 * (Inbox, the builders) is not the owner's to hand out. `enableAgentShare` is
 * presentation only; the same capability is enforced server-side on
 * `agentShare.enableShare`, and `undefined` (flags unresolved) keeps sharing
 * available to match the schema default.
 */
export const useAgentShareSupported = (agentId?: string | null): boolean => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const isBuiltinAgent = useAgentStore(builtinAgentSelectors.isBuiltinAgent(agentId ?? undefined));
  const enableAgentShare = useServerConfigStore(featureFlagsSelectors).enableAgentShare;

  return !!agentId && !hasActiveWorkspace && !isBuiltinAgent && enableAgentShare !== false;
};
