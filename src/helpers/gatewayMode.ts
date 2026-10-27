import { getServerConfigStoreState } from '@/store/serverConfig';

/**
 * Whether the deployment runs agents through the Agent Gateway — the predicate
 * every execution-target DISPLAY site shares so the picker/sidebar never
 * surface a `device` target the runtime can't actually reach.
 *
 * A configured `agentGatewayUrl` alone is NOT enough: the deployment must also
 * turn Gateway mode on (`enableGatewayMode`). There is no per-agent opt-out:
 * the browser has no agent runtime of its own to fall back to.
 *
 * This intentionally mirrors dispatch's own gate,
 * `GatewayActionImpl.isGatewayModeEnabled` in the gateway transport
 * (`store/chat/.../gateway/gateway.ts`) — keep the two in sync.
 *
 * `serverConfig` is read non-reactively: `agentGatewayUrl` / `enableGatewayMode`
 * are deployment-static app config, loaded once at hydration and never mutated
 * at runtime, so no store subscribes to them (and the display sites'
 * component tests deliberately run without the serverConfig context Provider).
 */
export const resolveGatewayModeEnabled = (): boolean => {
  const serverConfig = getServerConfigStoreState()?.serverConfig;

  return !!serverConfig?.agentGatewayUrl && !!serverConfig.enableGatewayMode;
};

/** Hook form of {@link resolveGatewayModeEnabled} for render call sites. */
export const useIsGatewayModeEnabled = (): boolean => resolveGatewayModeEnabled();
