import { describe, expect, it } from 'vitest';

import { findDeviceTopicDirectory, resolveDeviceGroupName } from './resolveDeviceGroup';

const directories = [
  { deviceId: 'dev-a', id: 'dir-a-plain' },
  { deviceId: 'dev-a', id: 'dir-a-instance', instanceId: 'ins-1' },
  { deviceId: 'dev-b', id: 'dir-b-instance', instanceId: 'ins-2' },
];

describe('findDeviceTopicDirectory', () => {
  it('returns the instance-bound directory on the given device', () => {
    expect(findDeviceTopicDirectory(directories, 'dev-a')?.id).toBe('dir-a-instance');
    expect(findDeviceTopicDirectory(directories, 'dev-b')?.id).toBe('dir-b-instance');
  });

  it('returns undefined when the device has no instance-bound directory, even with a plain one', () => {
    expect(findDeviceTopicDirectory([{ deviceId: 'dev-c', id: 'dir-c-plain' }], 'dev-c')).toBe(
      undefined,
    );
  });

  it('returns undefined for groups without a device (favorites, unknown bucket)', () => {
    expect(findDeviceTopicDirectory(directories, undefined)).toBeUndefined();
    expect(findDeviceTopicDirectory(directories)).toBeUndefined();
  });
});

describe('resolveDeviceGroupName', () => {
  it('keeps the synthetic group title (e.g. favorites) instead of the unknown label', () => {
    expect(resolveDeviceGroupName({ title: 'Favorites', unknownLabel: 'Unknown device' })).toBe(
      'Favorites',
    );
  });

  it('prefers the directory name, then device friendly name, then hostname', () => {
    expect(
      resolveDeviceGroupName({
        deviceName: '测试 MacBook',
        friendlyName: 'Mac',
        hostname: 'macbook-test',
        unknownLabel: 'Unknown device',
      }),
    ).toBe('测试 MacBook');
    expect(
      resolveDeviceGroupName({ friendlyName: 'Mac', hostname: 'macbook-test', unknownLabel: 'x' }),
    ).toBe('Mac');
    expect(resolveDeviceGroupName({ hostname: 'macbook-test', unknownLabel: 'x' })).toBe(
      'macbook-test',
    );
    expect(resolveDeviceGroupName({ unknownLabel: 'Unknown device' })).toBe('Unknown device');
  });
});
