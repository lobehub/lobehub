import { probeSandboxCapability } from './capability';
import { createSandboxEnv } from './env';
import { normalizeSandboxPolicy } from './policy';
import { srtSandboxRuntime } from './runtime';
import type { CreateSandboxLaunchPlanOptions, SandboxCapability, SandboxLaunchPlan } from './types';
import { SandboxError } from './types';

const unavailablePlan = (
  options: CreateSandboxLaunchPlanOptions,
  capability: SandboxCapability,
): SandboxLaunchPlan => {
  const reason = capability.reason ?? 'Device sandbox is unavailable';
  if (options.policy.onUnavailable === 'deny') {
    throw new SandboxError('SANDBOX_UNAVAILABLE', reason);
  }

  return {
    ...options.command,
    capability,
    env: createSandboxEnv(options.env ?? process.env, options.policy),
    sandboxed: false,
    warning: reason,
  };
};

export const createSandboxLaunchPlan = async (
  options: CreateSandboxLaunchPlanOptions,
): Promise<SandboxLaunchPlan> => {
  const policy = normalizeSandboxPolicy(options.policy);
  const capability = options.capability ?? (await probeSandboxCapability());

  if (!capability.available || capability.backend === 'none') {
    return unavailablePlan({ ...options, policy }, capability);
  }

  try {
    return await srtSandboxRuntime.createLaunchPlan({ ...options, policy }, capability);
  } catch (error) {
    if (
      policy.onUnavailable === 'warn-allow' &&
      !(error instanceof SandboxError && error.code === 'SANDBOX_POLICY_CONFLICT')
    ) {
      return unavailablePlan(
        { ...options, policy },
        { ...capability, available: false, reason: (error as Error).message },
      );
    }
    throw error;
  }
};
