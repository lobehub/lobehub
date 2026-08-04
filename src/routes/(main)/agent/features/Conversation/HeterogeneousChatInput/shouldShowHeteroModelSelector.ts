import type { DeviceExecutionTarget, HeterogeneousProviderConfig } from '@lobechat/types';

interface ShouldShowHeteroModelSelectorParams {
  boundDeviceId?: string;
  executionTarget: DeviceExecutionTarget;
  isDesktopClient: boolean;
  providerType?: HeterogeneousProviderConfig['type'];
}

export const shouldShowHeteroModelSelector = ({
  boundDeviceId,
  executionTarget,
  isDesktopClient,
  providerType,
}: ShouldShowHeteroModelSelectorParams): boolean => {
  // OpenCode has no cloud-side model list — its selector needs a concrete
  // runtime to discover models from: the desktop itself, or an explicit bound
  // device that answers listHeterogeneousAgentModels.
  if (providerType === 'opencode') {
    if (executionTarget === 'local') return isDesktopClient;
    return executionTarget === 'device' && !!boundDeviceId;
  }

  // Claude Code / Codex model + effort picks are forwarded on every execution
  // path: the desktop local spawn, the cloud sandbox, and device dispatch
  // (explicit `device`, `auto` routing, and web-initiated runs on a bound
  // desktop) all append `buildHeteroExecArgs` output to `lh hetero exec` — so
  // the selector is always shown.
  return true;
};
