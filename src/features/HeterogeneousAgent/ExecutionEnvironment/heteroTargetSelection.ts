import type { DeviceExecutionTarget } from '@lobechat/types';

import { executionTargetValue } from '@/features/ExecutionTargetPicker';

export type PrivateDeviceBlock = 'fixed' | 'publicAgent';

/**
 * Why the profile picker cannot bind a private workspace device, if it cannot.
 *
 * A manager's pick replaces the shared default that every member resolves, and
 * a private device resolves only for the member who enrolled it — so the
 * shared row may name one only on a private Agent that is not fixed. A
 * member's pick stays in their own override, where their private device is
 * fine. Personal agents have no private workspace devices at all.
 */
export const getPrivateDeviceBlock = ({
  canManageAgent,
  isWorkspaceAgent,
  selectionPolicy,
  visibility,
}: {
  canManageAgent: boolean;
  isWorkspaceAgent: boolean;
  selectionPolicy?: string;
  visibility?: 'private' | 'public';
}): PrivateDeviceBlock | undefined => {
  if (!isWorkspaceAgent || !canManageAgent) return;
  if (visibility !== 'private') return 'publicAgent';
  if (selectionPolicy === 'fixed') return 'fixed';
};

/** The picker value for a resolved target; undefined leaves the placeholder. */
export const getTargetSelectValue = (
  target: DeviceExecutionTarget,
  deviceId: string | undefined,
): string | undefined => {
  if (target === 'device') return deviceId ? executionTargetValue('device', deviceId) : undefined;
  if (target === 'local' || target === 'sandbox') return executionTargetValue(target);
};

export type TargetHint = 'default' | 'fixed' | 'overridden';

/** The one line under the picker: why it is locked, whose pick applies, or what it sets. */
export const getTargetHint = ({
  isOverridden,
  isSelectable,
}: {
  isOverridden: boolean;
  isSelectable: boolean;
}): TargetHint => (!isSelectable ? 'fixed' : isOverridden ? 'overridden' : 'default');
