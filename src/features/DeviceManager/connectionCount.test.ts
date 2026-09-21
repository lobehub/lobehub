import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getScopedConnectionCount, getWorkspaceConnectionState } from './connectionCount';

const device = (
  deviceId: string,
  scope: DeviceListItem['scope'],
  connectionCount: number,
): DeviceListItem =>
  ({
    channels: Array.from({ length: connectionCount }, (_, index) => ({
      channel: null,
      connectedAt: `2026-09-09T00:00:0${index}.000Z`,
      hostname: null,
      platform: null,
    })),
    deviceId,
    scope,
  }) as DeviceListItem;

describe('getScopedConnectionCount', () => {
  /** @example Personal presence cannot make an offline workspace device appear connected. */
  it('keeps personal and workspace connection counts independent', () => {
    // ROOT CAUSE:
    //
    // The Electron title bar previously showed its personal socket while a workspace target had
    // no live connection, making DEVICE_NOT_FOUND look contradictory. Counts now follow scope.
    const devices = [
      device('personal-device', 'personal', 2),
      device('workspace-device', 'workspace', 0),
    ];

    expect(getScopedConnectionCount(devices, 'personal', 'personal-device')).toBe(2);
    expect(getScopedConnectionCount(devices, 'workspace')).toBe(0);
  });

  /** @example Switching workspaces recomputes the total from the newly scoped device list. */
  it('aggregates multiple logical devices only within the current workspace response', () => {
    expect(
      getScopedConnectionCount(
        [device('workspace-a', 'workspace', 1), device('workspace-b', 'workspace', 2)],
        'workspace',
      ),
    ).toBe(3);
  });
});

describe('getWorkspaceConnectionState', () => {
  /** @example A failed first request does not claim that every workspace device is offline. */
  it('reports unavailable when the device list fails without cached data', () => {
    // ROOT CAUSE:
    //
    // The Electron title bar previously converted an undefined device list into a zero count after
    // an SWR error, presenting an unverified result as "No workspace device connection is online".
    // The unavailable state now preserves the distinction between a failed lookup and an empty list.
    expect(getWorkspaceConnectionState(undefined, false, new Error('network unavailable'))).toBe(
      'unavailable',
    );
  });

  /** @example Cached presence remains useful when a background revalidation request fails. */
  it('uses cached device presence during a revalidation error', () => {
    expect(
      getWorkspaceConnectionState(
        [device('workspace-device', 'workspace', 1)],
        false,
        new Error('revalidation failed'),
      ),
    ).toBe('connected');
  });
});
