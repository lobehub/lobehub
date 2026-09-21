import { describe, expect, it } from 'vitest';

import {
  filterAuthorizedDevicePresence,
  isGatewayOnlyDevicePresenceAllowed,
} from './scopedDevicePresence';

const onlineDevices = [{ deviceId: 'registered' }, { deviceId: 'gateway-only' }];

describe('filterAuthorizedDevicePresence', () => {
  /** @example Personal auto-registration may briefly lag behind Gateway presence. */
  it('retains Gateway-only devices in personal scope', () => {
    expect(
      filterAuthorizedDevicePresence(new Set(['registered']), onlineDevices, 'personal'),
    ).toEqual(onlineDevices);
  });

  /** @example Unshare removes authority even when a stale workspace socket remains connected. */
  it('excludes Gateway-only devices in workspace scope', () => {
    // ROOT CAUSE:
    //
    // Workspace Gateway presence used to create an executable transient device without a DB row.
    // If Unshare deleted the row while a stale process remained connected, the device resurfaced.
    // The shared policy now treats workspace rows as authority and Gateway only as liveness.
    expect(
      filterAuthorizedDevicePresence(new Set(['registered']), onlineDevices, 'workspace'),
    ).toEqual([{ deviceId: 'registered' }]);
    expect(isGatewayOnlyDevicePresenceAllowed('workspace')).toBe(false);
  });
});
