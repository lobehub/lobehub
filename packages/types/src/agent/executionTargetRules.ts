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

/**
 * What the model is told when it reaches for the remote-device picker on a
 * locked run. The picker is walled off (see {@link isDeviceLockedPlan}), so
 * without this it only looks missing ("Not found", "no available tool") and
 * the model keeps retrying, or gives up without telling the user that switching
 * devices is theirs to do.
 */
export const describeLockedDevicePicker = (plan: ExecutionPlan): string | undefined => {
  if (!isDeviceLockedPlan(plan)) return;

  const switchHint =
    'You cannot activate another device from here. If the user wants a different device, tell them to pick it in the device selector of the chat input and send the message again.';

  return plan.kind === 'device'
    ? `Device switching is off for this run: it is locked to device "${plan.deviceId}", where the Local System tools already run. ${switchHint}`
    : `Device switching is off for this run: it is locked to the user's bound device, which is offline. Tell the user to reconnect it (LobeHub desktop app or \`lh connect\`). ${switchHint}`;
};
