import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { summarizeDeviceGroup } from '../deviceGroupSummary';

const device = (deviceId: string, online: boolean) =>
  ({ channels: [], deviceId, hostname: deviceId, online }) as unknown as DeviceListItem;

describe('summarizeDeviceGroup', () => {
  it('counts online devices against the whole group', () => {
    const summary = summarizeDeviceGroup([
      device('a', true),
      device('b', false),
      device('c', true),
    ]);

    expect(summary.online).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.activeDevice).toBeUndefined();
  });

  it('names the active device only when it belongs to the group', () => {
    const devices = [device('a', true), device('b', false)];

    expect(summarizeDeviceGroup(devices, 'b').activeDevice?.deviceId).toBe('b');
    expect(summarizeDeviceGroup(devices, 'elsewhere').activeDevice).toBeUndefined();
  });

  it('handles an empty group', () => {
    expect(summarizeDeviceGroup([])).toEqual({
      activeDevice: undefined,
      online: 0,
      presenceUnknown: false,
      total: 0,
    });
  });

  it('flags a group whose presence is not confirmed yet', () => {
    const cached = { ...device('a', false), onlineUnknown: true } as DeviceListItem;

    expect(summarizeDeviceGroup([cached, device('b', true)]).presenceUnknown).toBe(true);
    expect(summarizeDeviceGroup([device('b', true)]).presenceUnknown).toBe(false);
  });
});
