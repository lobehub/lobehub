import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  getIdleConnectionStatus,
  getScopedConnectionCount,
  getWorkspaceConnectionState,
} from './connectionCount';

/** A `useDeviceList` result; unconfirmed (a stored copy, or nothing yet) unless stated. */
const listState = (
  state: { data?: DeviceListItem[]; error?: unknown; isConfirmed?: boolean } = {},
) => ({ data: undefined, error: undefined, isConfirmed: false, isLoading: false, ...state });

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
    expect(
      getWorkspaceConnectionState(listState({ error: new Error('network unavailable') })),
    ).toBe('unavailable');
  });

  /** @example Cached presence remains useful when a background revalidation request fails. */
  it('uses cached device presence during a revalidation error', () => {
    expect(
      getWorkspaceConnectionState(
        listState({
          data: [device('workspace-device', 'workspace', 1)],
          error: new Error('revalidation failed'),
          isConfirmed: true,
        }),
      ),
    ).toBe('connected');
  });

  it('reports disconnected once the server confirms no live workspace connection', () => {
    expect(
      getWorkspaceConnectionState(
        listState({ data: [device('workspace-device', 'workspace', 0)], isConfirmed: true }),
      ),
    ).toBe('disconnected');
  });
});

describe('persisted rows before the server confirms presence', () => {
  const persisted = (deviceId: string, scope: DeviceListItem['scope']): DeviceListItem => ({
    ...device(deviceId, scope, 0),
    online: false,
    onlineUnknown: true,
  });

  /** @example A reload paints the stored list with no channels; that is not "0 connections". */
  it('reports no count while a matching row is still the persisted copy', () => {
    expect(getScopedConnectionCount([persisted('workspace-a', 'workspace')], 'workspace')).toBe(
      undefined,
    );
    // An unrelated scope's placeholder does not hide a confirmed count.
    expect(
      getScopedConnectionCount(
        [persisted('workspace-a', 'workspace'), device('personal-a', 'personal', 1)],
        'personal',
      ),
    ).toBe(1);
  });

  it('reads the workspace as connecting, not disconnected, until presence is confirmed', () => {
    const devices = [persisted('workspace-a', 'workspace')];

    expect(getWorkspaceConnectionState(listState({ data: devices }))).toBe('connecting');
    expect(
      getWorkspaceConnectionState(listState({ data: devices, error: new Error('offline') })),
    ).toBe('unavailable');
  });

  /** @example A stale (or capped) stored copy holding only personal rows is not an empty pool. */
  it('keeps a stored copy without workspace rows pending until the server answers', () => {
    const devices = [persisted('personal-a', 'personal')];

    expect(getWorkspaceConnectionState(listState({ data: devices }))).toBe('connecting');
    expect(
      getWorkspaceConnectionState(listState({ data: devices, error: new Error('offline') })),
    ).toBe('unavailable');
  });

  it('says checking, not offline, for a persisted row with no connection', () => {
    expect(getIdleConnectionStatus(persisted('dev-a', 'personal'))).toBe('checking');
    expect(getIdleConnectionStatus(device('dev-a', 'personal', 0))).toBe('offline');
  });
});
