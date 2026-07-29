import { useAgentStore } from '@/store/agent';
import { type AgentStoreState } from '@/store/agent/initialState';
import { agentSelectors } from '@/store/agent/selectors';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

/**
 * Whether Gateway mode is EFFECTIVELY enabled for a run — the predicate every
 * execution-target DISPLAY site shares so the picker/sidebar never surface a
 * `device` target the runtime can't actually reach.
 *
 * A configured `agentGatewayUrl` alone is NOT enough: the deployment must also
 * turn Gateway mode on (`enableGatewayMode`) and the agent (or the user's
 * default agent config) must not opt out via `disableGatewayMode`. When any of
 * these is false, sends fall back to the non-gateway client path, so a bound
 * `local` target cannot actually reach the device — the display must keep it as
 * `sandbox` rather than surfacing `device` (LOBE-11473 follow-up).
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
 * ActionBar / advanced settings), so the reactive `useIsGatewayModeEnabled`
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
 * Resolve the effective `disableGatewayMode` opt-out from an agent state: the
 * agent's own `chatConfig.disableGatewayMode`, falling back to the user's
 * default agent config. `disableGatewayMode: undefined` = enabled.
 */
const resolveDisableGatewayMode = (
  agentState: AgentStoreState,
  resolvedAgentId: string | undefined,
): boolean | undefined => {
  const agentDisableGatewayMode = resolvedAgentId
    ? agentSelectors.getAgentConfigById(resolvedAgentId)(agentState)?.chatConfig?.disableGatewayMode
    : undefined;
  const defaultDisableGatewayMode = settingsSelectors.defaultAgentConfig(useUserStore.getState())
    .chatConfig?.disableGatewayMode;

  return agentDisableGatewayMode ?? defaultDisableGatewayMode;
};

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
 * (agent chatConfig + user default) so toggling Gateway Mode from the chat
 * ActionBar re-renders the display and it stops surfacing a `device` target
 * once sends have fallen back to sandbox (LOBE-11473 follow-up). `serverConfig`
 * stays a non-reactive read — see `resolveGatewayModeEnabled`'s note.
 */
export const useIsGatewayModeEnabled = (agentId?: string): boolean => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const resolvedAgentId = agentId ?? activeAgentId;
  const agentDisableGatewayMode = useAgentStore((s) =>
    resolvedAgentId
      ? agentSelectors.getAgentConfigById(resolvedAgentId)(s)?.chatConfig?.disableGatewayMode
      : undefined,
  );
  const defaultDisableGatewayMode = useUserStore(
    (s) => settingsSelectors.defaultAgentConfig(s).chatConfig?.disableGatewayMode,
  );
  const disableGatewayMode = agentDisableGatewayMode ?? defaultDisableGatewayMode;

  return evaluateGatewayModeEnabled(disableGatewayMode);
};
