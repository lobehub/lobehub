import type { DeviceScope } from '@lobechat/types';

/**
 * Reports whether a scope may surface a live device before its registry row exists.
 *
 * Use when:
 * - A caller can avoid fetching Gateway presence that cannot be authorized
 *
 * Expects:
 * - `scope` is the principal being queried
 *
 * Returns:
 * - `true` only for the personal auto-registration compatibility window
 */
export const isGatewayOnlyDevicePresenceAllowed = (scope: DeviceScope): boolean =>
  scope === 'personal';

/**
 * Filters Gateway presence through the registry authority for one device scope.
 *
 * Use when:
 * - Merging live Gateway connections into device registry rows
 * - Deciding whether Gateway-only devices may enter a picker or runtime
 *
 * Expects:
 * - `registeredDeviceIds` contains rows visible to the authorized caller
 * - `onlineDevices` contains only connections from the requested principal
 *
 * Returns:
 * - Every personal connection, or only registered workspace connections
 */
export const filterAuthorizedDevicePresence = <T extends { deviceId: string }>(
  registeredDeviceIds: ReadonlySet<string>,
  onlineDevices: T[],
  scope: DeviceScope,
): T[] =>
  isGatewayOnlyDevicePresenceAllowed(scope)
    ? onlineDevices
    : onlineDevices.filter((device) => registeredDeviceIds.has(device.deviceId));
