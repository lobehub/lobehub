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
  if (providerType === 'opencode') {
    if (executionTarget === 'local') return isDesktopClient;
    return executionTarget === 'device' && !!boundDeviceId;
  }

  if (executionTarget === 'auto' || executionTarget === 'device') return false;

  // A desktop "local" selection stores that desktop's connected-device id so
  // web clients can route back to the same machine. On web this is a device
  // dispatch, and selector args are not capability-gated for devices yet.
  if (!isDesktopClient && executionTarget === 'local' && boundDeviceId) return false;

  return true;
};
