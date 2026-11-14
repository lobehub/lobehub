import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { splitThisComputerDevices } from '../thisComputerDevices';

const device = (deviceId: string): DeviceListItem => ({ deviceId }) as DeviceListItem;
const ids = (rows: DeviceListItem[]) => rows.map((row) => row.deviceId);

describe('splitThisComputerDevices', () => {
  const rows = [device('mine-personal'), device('zeabur'), device('hetzner')];

  it('keeps this machine out of the other devices', () => {
    const result = splitThisComputerDevices(rows, { localMachineIds: ['mine-personal'] });

    expect(ids(result.otherDevices)).toEqual(['zeabur', 'hetzner']);
    // The "This computer" row already covers running here.
    expect(result.thisComputerDevices).toEqual([]);
  });

  it("lists this machine's workspace row under This computer", () => {
    const result = splitThisComputerDevices([device('mine-workspace'), ...rows.slice(1)], {
      localMachineIds: ['mine-personal', 'mine-workspace'],
      ownWorkspaceDeviceId: 'mine-workspace',
    });

    expect(ids(result.thisComputerDevices)).toEqual(['mine-workspace']);
    expect(ids(result.otherDevices)).toEqual(['zeabur', 'hetzner']);
  });

  it("keeps this machine's row visible while it is the active pick", () => {
    const result = splitThisComputerDevices(rows, {
      activeDeviceId: 'mine-personal',
      localMachineIds: ['mine-personal'],
    });

    expect(ids(result.thisComputerDevices)).toEqual(['mine-personal']);
  });

  // Regression: a public workspace row this machine enrolled is a team device.
  // It was dropped from both groups, so its publisher could not pick it.
  it('keeps a public workspace row of this machine among the other devices', () => {
    const shared = { ...device('mine-workspace'), scope: 'workspace', visibility: 'public' };
    const result = splitThisComputerDevices([shared as DeviceListItem, ...rows.slice(1)], {
      localMachineIds: ['mine-personal', 'mine-workspace'],
    });

    expect(ids(result.otherDevices)).toEqual(['mine-workspace', 'zeabur', 'hetzner']);
    expect(result.thisComputerDevices).toEqual([]);
  });

  it('treats every row as another device off desktop', () => {
    const result = splitThisComputerDevices(rows, { localMachineIds: [] });

    expect(ids(result.otherDevices)).toEqual(['mine-personal', 'zeabur', 'hetzner']);
    expect(result.thisComputerDevices).toEqual([]);
  });
});
