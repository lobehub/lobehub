import type { AgentState } from '@lobechat/agent-runtime';

import { isDeviceCapablePlan } from '@/helpers/executionTarget';

/**
 * Single-track device gate shared by the run executors: the execution plan
 * (and the device access policy) is the only authority on whether this run
 * may touch a device. `binding.device.id` alone is NOT sufficient — a
 * mid-run side effect can leave it stale — so every consumer (LLM tool
 * injection in `callLlm`, tool execution contexts in `callTool` /
 * `callToolsBatch`) must read the id through this filter. Plans absent on
 * old / resumed operations fall back to the policy-only gate.
 *
 * {@link runMayUseDevice} is that authority on its own: the step boundary asks it
 * before binding a device out of the message history at all, so a run that may
 * not touch a device never adopts one — and never leaks its working directory
 * and system info into the prompt variables.
 *
 * `device-unrouted` deliberately passes the id through (via
 * `isDeviceCapablePlan`): the run-start id is derived strictly from the plan
 * (`aiAgent` sets it only for `kind === 'device'`), so an id appearing under
 * a `device-unrouted` plan can only come from a legitimate mid-run activation
 * — the model selecting a device with the `lobe-remote-device` tool, whose
 * pluginState `computeDeviceContext` folds back into `binding.device` at the
 * next step boundary while the plan still says unrouted. Tightening the gate to
 * `kind === 'device'` would swallow exactly that flow.
 */
export const runMayUseDevice = (state: Pick<AgentState, 'plan' | 'principal'>): boolean => {
  const devicePolicy = state.principal?.policy?.deviceAccess;
  const executionPlan = state.plan?.execution;
  const planAllowsDevice = !executionPlan || isDeviceCapablePlan(executionPlan);

  return devicePolicy?.canUseDevice !== false && planAllowsDevice;
};

export const resolveRunActiveDeviceId = (
  state: Pick<AgentState, 'binding' | 'plan' | 'principal'>,
): string | undefined => (runMayUseDevice(state) ? state.binding?.device?.id : undefined);
