import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isCurrentMachineDevice, splitPickerDevices } from './devicePicker';

const device = (deviceId: string, patch: Partial<DeviceListItem> = {}) =>
  ({ deviceId, hostname: deviceId, online: true, ...patch }) as DeviceListItem;

describe('isCurrentMachineDevice', () => {
  it('matches by any of the machine ids', () => {
    expect(isCurrentMachineDevice(device('a'), { ids: ['b', 'a'] })).toBe(true);
    expect(isCurrentMachineDevice(device('c'), { ids: ['b', 'a'] })).toBe(false);
  });

  it('falls back to the hostname only for an online row', () => {
    const machine = { hostname: 'WIN', ids: ['x'] };
    expect(isCurrentMachineDevice(device('ws', { hostname: 'WIN' }), machine)).toBe(true);
    expect(
      isCurrentMachineDevice(device('stale', { hostname: 'WIN', online: false }), machine),
    ).toBe(false);
  });
});

describe('splitPickerDevices', () => {
  it('puts this machine first and separates offline devices', () => {
    const result = splitPickerDevices(
      [
        device('mac'),
        device('old', { online: false }),
        device('win'),
        device('checking', { online: false, onlineUnknown: true }),
      ],
      { ids: ['win'] },
    );

    expect(result.current?.deviceId).toBe('win');
    expect(result.available.map((d) => d.deviceId)).toEqual(['win', 'mac', 'checking']);
    expect(result.offline.map((d) => d.deviceId)).toEqual(['old']);
  });

  it('prefers an id match over a hostname match', () => {
    const result = splitPickerDevices(
      [device('ws', { hostname: 'WIN' }), device('win', { hostname: 'WIN' })],
      { hostname: 'WIN', ids: ['win'] },
    );

    expect(result.current?.deviceId).toBe('win');
  });
});
