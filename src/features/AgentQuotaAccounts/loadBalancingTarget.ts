import type { DeviceExecutionTarget } from '@lobechat/types';

/**
 * Whether runs on this execution target are balanced across the agent's
 * subscription accounts: only Claude Code spawned on this desktop (`local`) or
 * on one bound device. The cloud sandbox and `auto` have no device whose login
 * a choice could name, so a Manual pick made for them would be ignored by every
 * run. Mirrors the chat bar's quota menu gate.
 */
export const balancesAccountsOn = (target: DeviceExecutionTarget, deviceId?: string): boolean =>
  target === 'local' || (target === 'device' && !!deviceId);
