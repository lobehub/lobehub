import { getAgentStoreState } from '@/store/agent';
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
 * (`store/chat/.../gateway/gateway.ts`) — keep the two in sync. It is kept
 * separate because dispatch reads `window.global_serverConfigStore` directly
 * (its tests mock that global), while display sites read the module singleton
 * via `getServerConfigStoreState()`. `disableGatewayMode: undefined` = enabled.
 *
 * Reads stores non-reactively via `getState()` — safe for callers that already
 * re-render on the underlying agent/server config, and for selectors that
 * cannot subscribe to a second store.
 */
export const isGatewayModeEnabled = (agentId?: string): boolean => {
  const serverConfig = getServerConfigStoreState()?.serverConfig;
  const agentState = getAgentStoreState();
  const resolvedAgentId = agentId ?? agentState.activeAgentId;
  const agentDisableGatewayMode = resolvedAgentId
    ? agentSelectors.getAgentConfigById(resolvedAgentId)(agentState)?.chatConfig?.disableGatewayMode
    : undefined;
  const defaultDisableGatewayMode = settingsSelectors.defaultAgentConfig(useUserStore.getState())
    .chatConfig?.disableGatewayMode;
  const disableGatewayMode = agentDisableGatewayMode ?? defaultDisableGatewayMode;

  return (
    !!serverConfig?.agentGatewayUrl &&
    !!serverConfig.enableGatewayMode &&
    disableGatewayMode !== true
  );
};
