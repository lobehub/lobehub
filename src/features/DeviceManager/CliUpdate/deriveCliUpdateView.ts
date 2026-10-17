import type { DeviceCliUpdateOperation, DeviceCliUpdateStateResult } from '@lobechat/types';

type CliUpdateView =
  | 'failed'
  | 'loading'
  | 'pending'
  | 'ready'
  | 'success'
  | 'timedOut'
  | 'unavailable'
  | 'unsupported';

export const deriveCliUpdateView = (
  result: DeviceCliUpdateStateResult | undefined,
  operation?: DeviceCliUpdateOperation,
  timedOut = false,
): CliUpdateView => {
  const state = result?.status === 'ok' ? result.state : undefined;
  const pending = operation ?? state?.operation;
  if (pending) {
    if (state?.operation?.id === pending.id && state.operation.stage === 'failed') return 'failed';
    if (pending.stage === 'failed') return 'failed';
    if (
      state &&
      state.instanceId !== pending.fromInstanceId &&
      state.currentVersion === pending.targetVersion
    )
      return 'success';
    return timedOut ? 'timedOut' : 'pending';
  }
  if (!result) return 'loading';
  if (result.status === 'unsupported' || state?.supported === false) return 'unsupported';
  if (result.status === 'unavailable' || result.status === 'rejected') return 'unavailable';
  return 'ready';
};
