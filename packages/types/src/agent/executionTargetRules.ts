import type { DeviceExecutionTarget, ExecutionPlan } from './agencyConfig';
import type { RuntimeEnvMode } from './agentConfig';
import type { LobeAgentChatConfig } from './chatConfig';

/**
 * Tool-resolution mode: an explicit `toolMode` wins; otherwise derive from
 * `enableAgentMode` (undefined = agent). `custom` = the toolset is exactly the
 * agent's plugins. Every host must derive chat mode through this so the tool
 * engine, the context engine and the execution plan agree on what chat mode is.
 */
export const resolveToolMode = (
  chatConfig: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'toolMode'> | undefined | null,
): 'agent' | 'chat' | 'custom' =>
  chatConfig?.toolMode ?? (chatConfig?.enableAgentMode === false ? 'chat' : 'agent');

/** The runtime-mode tool gate (`cloud` / `local` / `none`) of an execution target. */
export const executionTargetToRuntimeMode = (target: DeviceExecutionTarget): RuntimeEnvMode => {
  switch (target) {
    case 'local': {
      return 'local';
    }
    case 'sandbox': {
      return 'cloud';
    }
    default: {
      return 'none';
    }
  }
};

export const isDeviceCapablePlan = (plan: ExecutionPlan): boolean =>
  plan.kind === 'device' || plan.kind === 'device-unrouted';

/**
 * The run is committed to ONE device: either already routed (`device`, which
 * includes the opt-in `auto` single-online activation) or locked to an
 * explicit binding that is currently offline (`bound-device-offline` waits for
 * that machine rather than hopping elsewhere). A locked run has no device
 * decision left, so the remote-device picker must not exist for it — not even
 * as an activator-discoverable manifest, since explicit activation bypasses
 * the rule-layer gates.
 */
export const isDeviceLockedPlan = (plan: ExecutionPlan): boolean =>
  plan.kind === 'device' ||
  (plan.kind === 'device-unrouted' && plan.reason === 'bound-device-offline');
