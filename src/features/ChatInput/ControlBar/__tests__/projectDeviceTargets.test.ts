import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { listProjectDeviceTargets } from '../projectDeviceTargets';

const directory = (id: string, deviceId: string, extra: Partial<ProjectDirectory> = {}) =>
  ({
    deviceId,
    deviceName: null,
    id,
    instanceId: `instance-${id}`,
    name: id,
    path: `/work/${id}`,
    permission: 'readWrite',
    platform: 'darwin',
    ...extra,
  }) as ProjectDirectory;
const device = (deviceId: string, friendlyName: string, online = true) =>
  ({ channels: [], deviceId, friendlyName, online }) as unknown as DeviceListItem;

describe('listProjectDeviceTargets', () => {
  const devices = [
    device('dev-a', 'Device A'),
    device('dev-b', 'Device B', false),
    // Online, but the project has no directory there.
    device('dev-c', 'Device C'),
  ];

  it('offers one target per project directory, never a device without one', () => {
    const targets = listProjectDeviceTargets(
      [directory('dir-a', 'dev-a'), directory('dir-b', 'dev-b')],
      devices,
      'dir-a',
    );
    expect(targets.map((t) => [t.label, t.active, t.online])).toEqual([
      ['Device A', true, true],
      ['Device B', false, false],
    ]);
  });

  it('drops directories that cannot host a run', () => {
    const targets = listProjectDeviceTargets(
      [
        directory('legacy', 'dev-a', { instanceId: null }),
        directory('read-only', 'dev-c', { permission: 'read' as ProjectDirectory['permission'] }),
      ],
      devices,
      undefined,
    );
    expect(targets).toEqual([]);
  });

  it('names a device the list does not know by its directory row', () => {
    const [target] = listProjectDeviceTargets(
      [directory('dir-x', 'dev-x', { deviceName: 'Build box' })],
      devices,
      undefined,
    );
    expect(target).toMatchObject({ label: 'Build box', online: false });
  });
});
