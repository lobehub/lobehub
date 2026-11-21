import type { AcceptanceStatus, VerifyRunStatus } from '@lobechat/types';

interface RepairProgress {
  deliveryRunStatus?: VerifyRunStatus | null;
  deliveryStatus?: AcceptanceStatus;
  previewUrl?: string;
  state: 'failed' | 'finished' | 'running' | 'starting';
}

export const repairPresentation = (repair: RepairProgress) => {
  if (repair.state !== 'finished') return repair.state;
  if (repair.deliveryStatus === 'verifying' || repair.deliveryStatus === 'planned')
    return 'verifying';
  if (!repair.deliveryRunStatus) return 'awaitingDelivery';
  if (['failed', 'uncertain', 'errored'].includes(repair.deliveryRunStatus))
    return 'verificationFailed';
  if (repair.deliveryRunStatus !== 'passed') return 'awaitingDelivery';
  return repair.previewUrl ? 'ready' : 'awaitingPreview';
};
