import type { HeteroExecutionTarget, LobeAgentAgencyConfig, RuntimeEnvMode } from '@lobechat/types';

/**
 * Single source of truth for where an agent executes. Replaces the old
 * per-platform `chatConfig.runtimeEnv.runtimeMode` record — one global
 * `agencyConfig.executionTarget` drives both desktop and web.
 *
 * - `local`   → 本机 (this machine, in-process; desktop only)
 * - `sandbox` → 云端沙箱 (server cloud sandbox)
 * - `device`  → 远程设备 (dispatched to `boundDeviceId`)
 *
 * Defaults: desktop → `local`, web → `sandbox`. On web `local` isn't available
 * (no local filesystem), so a stored `local` (synced from desktop) resolves to
 * `sandbox`.
 */
export const resolveExecutionTarget = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  isDesktop: boolean,
): HeteroExecutionTarget => {
  const stored = agencyConfig?.executionTarget;
  const effective = stored ?? (isDesktop ? 'local' : 'sandbox');
  if (!isDesktop && effective === 'local') return 'sandbox';
  return effective;
};

/**
 * Derive the legacy `runtimeMode` (still used by the server tool gate) from the
 * unified execution target: `local` → local-system tools, `sandbox` → cloud
 * sandbox, `device` → gateway-dispatched tools.
 */
export const executionTargetToRuntimeMode = (target: HeteroExecutionTarget): RuntimeEnvMode => {
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

/**
 * The effective `runtimeMode` (server tool gate) from the unified execution
 * target, with a no-regression fallback: agents that predate `executionTarget`
 * still honour their legacy per-platform `runtimeMode` until migrated. New
 * writes set `executionTarget`, so this fallback fades out over time.
 */
export const resolveRuntimeMode = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  legacyRuntimeMode: RuntimeEnvMode | undefined,
  isDesktop: boolean,
): RuntimeEnvMode => {
  if (!agencyConfig?.executionTarget && legacyRuntimeMode) return legacyRuntimeMode;
  return executionTargetToRuntimeMode(resolveExecutionTarget(agencyConfig, isDesktop));
};
