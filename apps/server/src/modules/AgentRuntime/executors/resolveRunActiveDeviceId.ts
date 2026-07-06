import { type ExecutionPlan, isDeviceCapablePlan } from '@/helpers/executionTarget';
import { type DeviceAccessReason } from '@/server/services/aiAgent/deviceToolAudit';

/**
 * Single-track device gate shared by the run executors: the execution plan
 * (and the device access policy) is the only authority on whether this run
 * may touch a device. `metadata.activeDeviceId` alone is NOT sufficient — the
 * desktop client can preset it on the run request, and a mid-run side effect
 * can leave it stale — so every consumer (LLM tool injection in `callLlm`,
 * tool execution contexts in `callTool` / `callToolsBatch`) must read the id
 * through this filter. Plans absent on old / resumed operations fall back to
 * the policy-only gate.
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
