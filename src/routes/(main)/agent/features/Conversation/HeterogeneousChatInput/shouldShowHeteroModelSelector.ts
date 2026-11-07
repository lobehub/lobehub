import type { DeviceExecutionTarget, HeterogeneousProviderConfig } from '@lobechat/types';
import { getHeteroSelectorCapability } from '@lobechat/types';

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
  // Codex keeps its saved/built-in model fallback and effort controls even when
  // discovery has no concrete target (for example auto routing or a sandbox).
  if (providerType === 'codex') return true;

  // Catalog providers have no cloud-side model list — their selectors need a
  // concrete runtime to discover models from: the desktop itself, or an explicit
  // bound device that answers listHeterogeneousAgentModels.
  if (getHeteroSelectorCapability(providerType)?.model?.source === 'catalog') {
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
