import { type ExecutionPlan, isDeviceCapablePlan } from '@/helpers/executionTarget';
import { type DeviceAccessReason } from '@/server/services/aiAgent/deviceToolAudit';

/**
 * Single-track device gate shared by the run executors: the execution plan
 * (and the device access policy) is the only authority on whether this run
 * may touch a device. `metadata.activeDeviceId` alone is NOT sufficient — a
 * mid-run side effect can leave it stale — so every consumer (LLM tool
 * injection in `callLlm`, tool execution contexts in `callTool` /
 * `callToolsBatch`) must read the id through this filter. Plans absent on
 * old / resumed operations fall back to the policy-only gate.
 *
 * `device-unrouted` deliberately passes the id through (via
 * `isDeviceCapablePlan`): the run-start id is derived strictly from the plan
 * (`aiAgent` sets it only for `kind === 'device'`), so an id appearing under
 * a `device-unrouted` plan can only come from a legitimate mid-run activation
 * — the model selecting a device with the `lobe-remote-device` tool, whose
 * pluginState `computeDeviceContext` folds back into the metadata at the next
 * step boundary while the plan still says unrouted. Tightening the gate to
 * `kind === 'device'` would swallow exactly that flow.
 */
export const resolveRunActiveDeviceId = (metadata?: {
  activeDeviceId?: string;
  deviceAccessPolicy?: unknown;
  executionPlan?: unknown;
}): string | undefined => {
  const devicePolicy = metadata?.deviceAccessPolicy as
    { canUseDevice: boolean; reason: DeviceAccessReason } | undefined;
  const executionPlan = metadata?.executionPlan as ExecutionPlan | undefined;
  const planAllowsDevice = !executionPlan || isDeviceCapablePlan(executionPlan);

  if (devicePolicy?.canUseDevice === false || !planAllowsDevice) return undefined;

  return metadata?.activeDeviceId;
};
