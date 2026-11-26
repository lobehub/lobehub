import { useAgentStore } from '@/store/agent';
import { type AgentStoreState } from '@/store/agent/initialState';
import { agentSelectors } from '@/store/agent/selectors';
import { getServerConfigStoreState } from '@/store/serverConfig';

/**
 * Whether Gateway mode is EFFECTIVELY enabled for a run — the predicate every
 * execution-target DISPLAY site shares so the picker/sidebar never surface a
 * `device` target the runtime can't actually reach.
 *
 * A configured `agentGatewayUrl` alone is NOT enough: the deployment must also
 * turn Gateway mode on (`enableGatewayMode`) and the agent must not opt out via
 * its own `chatConfig.disableGatewayMode`. When any of
 * these is false, sends fall back to the non-gateway client path, so a bound
 * `local` target cannot actually reach the device — the display must keep it as
 * `sandbox` rather than surfacing `device` ( follow-up).
 *
 * This intentionally mirrors dispatch's own gate,
 * `GatewayActionImpl.isGatewayModeEnabled` in the gateway transport
 * (`store/chat/.../gateway/gateway.ts`) — keep the two in sync.
 *
 * `serverConfig` is read non-reactively: `agentGatewayUrl` / `enableGatewayMode`
 * are deployment-static app config, loaded once at hydration and never mutated
 * at runtime, so no store subscribes to them (and the display sites'
 * component tests deliberately run without the serverConfig context Provider).
 * `disableGatewayMode`, by contrast, is user-toggleable at runtime (the chat
 * ActionBar), so the reactive `useIsGatewayModeEnabled`
 * hook subscribes to it — see that hook's note.
 */
const evaluateGatewayModeEnabled = (disableGatewayMode: boolean | undefined): boolean => {
  const serverConfig = getServerConfigStoreState()?.serverConfig;

  return (
    !!serverConfig?.agentGatewayUrl &&
    !!serverConfig.enableGatewayMode &&
    disableGatewayMode !== true
  );
};

/**
 * Resolve the agent's own `chatConfig.disableGatewayMode` opt-out.
 * `disableGatewayMode: undefined` = enabled. Gateway mode is a per-agent
 * setting only: the user's default agent config is deliberately NOT a fallback
 * (the global switch was removed; `scripts/backfillAgentGatewayModeOptOut`
 * copied existing global opt-outs onto each Agent).
 */
const resolveDisableGatewayMode = (
  agentState: AgentStoreState,
  resolvedAgentId: string | undefined,
): boolean | undefined =>
  resolvedAgentId
    ? agentSelectors.getAgentConfigById(resolvedAgentId)(agentState)?.chatConfig?.disableGatewayMode
    : undefined;

/**
 * Selector-friendly, non-reactive variant: derives the gate from an agent store
 * state the caller already holds (e.g. a zustand selector's `s`). It re-runs
 * whenever the enclosing `useAgentStore(selector)` re-evaluates on an agent
 * store change, so it stays reactive to `disableGatewayMode` without a second
 * global read.
 */
export const resolveGatewayModeEnabled = (
  agentState: AgentStoreState,
  agentId?: string,
): boolean => {
  const resolvedAgentId = agentId ?? agentState.activeAgentId;

  return evaluateGatewayModeEnabled(resolveDisableGatewayMode(agentState, resolvedAgentId));
};

/**
 * Reactive hook for render call sites (device switcher, workspace sidebar,
 * resource/skill panels). Subscribes to the live-mutable `disableGatewayMode`
 * (the agent's own chatConfig) so toggling Gateway Mode from the chat
 * ActionBar re-renders the display and it stops surfacing a `device` target
 * once sends have fallen back to sandbox ( follow-up). `serverConfig`
 * stays a non-reactive read — see `resolveGatewayModeEnabled`'s note.
 */
export const useIsGatewayModeEnabled = (agentId?: string): boolean => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const resolvedAgentId = agentId ?? activeAgentId;
  const disableGatewayMode = useAgentStore((s) => resolveDisableGatewayMode(s, resolvedAgentId));

  return evaluateGatewayModeEnabled(disableGatewayMode);
};
