import type { DeviceExecutionTarget } from '@lobechat/types';

import { executionTargetValue } from '@/features/ExecutionTargetPicker';

export type PrivateDeviceBlock = 'fixed' | 'publicAgent';

/**
 * Why a manager's picker cannot bind a private workspace device, if it cannot.
 *
 * A manager's pick replaces the shared default that every member resolves, and
 * a private device resolves only for the member who enrolled it — so the
 * shared row of a published Agent should not name one (`publicAgent`), and a
 * published fixed Agent cannot: the server rejects it (`fixed`,
 * `FixedAgentRequiresPublicWorkspaceDevice`). A private Agent has a single
 * runner, its owner, and its selection policy is dormant until publication
 * (publishing re-checks the fixed target), so any of the owner's private
 * devices is fine there. A member's pick stays in their own override, where
 * their private device is fine. Personal agents have no private workspace
 * devices at all.
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
  if (visibility === 'private') return;
  return selectionPolicy === 'fixed' ? 'fixed' : 'publicAgent';
};

/**
 * The picker value for a resolved target; undefined leaves the placeholder. A LobeHub agent
 * lists "No device" and "Auto" as choices of their own; for a heterogeneous agent they are not
 * choices, and `none` is the pending state that asks for a device.
 */
export const getTargetSelectValue = (
  target: DeviceExecutionTarget,
  deviceId: string | undefined,
  { builtin = false }: { builtin?: boolean } = {},
): string | undefined => {
  if (target === 'device') return deviceId ? executionTargetValue('device', deviceId) : undefined;
  if (target === 'local' || target === 'sandbox') return executionTargetValue(target);
  if (builtin) return executionTargetValue(target);
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
