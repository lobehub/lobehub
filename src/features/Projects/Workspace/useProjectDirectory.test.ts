import { describe, expect, it } from 'vitest';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { addedFolderTarget, directoriesOnDevice } from './useProjectDirectory';

const directory = (id: string, deviceId: string, extra: Partial<ProjectDirectory> = {}) =>
  ({
    deviceId,
    id,
    instanceId: `inst-${id}`,
    name: id,
    path: `/work/${id}`,
    permission: 'readWrite',
    ...extra,
  }) as ProjectDirectory;

describe('directoriesOnDevice', () => {
  const all = [
    directory('mail', 'studio'),
    directory('tts', 'studio'),
    directory('other', 'laptop'),
    directory('unlinked', 'studio', { instanceId: null }),
    directory('readonly', 'studio', { permission: 'read' } as Partial<ProjectDirectory>),
  ];

  it("offers the project's runnable folders on that machine only", () => {
    expect(directoriesOnDevice(all, 'studio').map((item) => item.id)).toEqual(['mail', 'tts']);
  });

  it('offers nothing without a machine, as on the cloud sandbox', () => {
    expect(directoriesOnDevice(all, undefined)).toEqual([]);
  });
});

describe('addedFolderTarget', () => {
  // Opened from device A's row, saved on device B: the run follows the folder.
  it('moves the run to the device the folder was saved on, not the row it came from', () => {
    expect(addedFolderTarget({ deviceId: 'laptop' }, 'device', 'desktop')).toEqual({
      deviceId: 'laptop',
      target: 'device',
    });
  });

  it('keeps a folder on this desktop local when added from the local row', () => {
    expect(addedFolderTarget({ deviceId: 'desktop' }, 'local', 'desktop')).toEqual({
      target: 'local',
    });
  });

  it('treats a folder moved to another machine from the local row as a device run', () => {
    expect(addedFolderTarget({ deviceId: 'studio' }, 'local', 'desktop')).toEqual({
      deviceId: 'studio',
      target: 'device',
    });
  });
});
