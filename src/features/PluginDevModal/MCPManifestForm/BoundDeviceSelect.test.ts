import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { bindableMcpDeviceGroups } from './BoundDeviceSelect';

const device = (deviceId: string, scope: 'personal' | 'workspace', visibility?: string) =>
  ({ deviceId, scope, visibility }) as DeviceListItem;

// A device list carries the caller's personal devices, the workspace's public
// ones and only the caller's own private workspace enrollments
const devices = [
  device('laptop', 'personal'),
  device('my-private', 'workspace', 'private'),
  device('office-nas', 'workspace', 'public'),
];

const ids = (groups: ReturnType<typeof bindableMcpDeviceGroups>) => ({
  private: groups.private.map((d) => d.deviceId),
  shared: groups.shared.map((d) => d.deviceId),
});

describe('bindableMcpDeviceGroups', () => {
  it('offers a personal server the personal devices', () => {
    expect(ids(bindableMcpDeviceGroups(devices, false))).toEqual({
      private: [],
      shared: ['laptop'],
    });
  });

  it('offers a shared workspace server the public workspace devices only', () => {
    expect(ids(bindableMcpDeviceGroups(devices, true))).toEqual({
      private: [],
      shared: ['office-nas'],
    });
  });

  it("also offers a private workspace server its creator's private devices", () => {
    expect(ids(bindableMcpDeviceGroups(devices, true, true))).toEqual({
      private: ['my-private'],
      shared: ['office-nas'],
    });
  });

  it('keeps personal devices out of a private workspace server', () => {
    expect(ids(bindableMcpDeviceGroups([device('laptop', 'personal')], true, true))).toEqual({
      private: [],
      shared: [],
    });
  });
});
