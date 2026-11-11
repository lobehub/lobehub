import { describe, expect, it } from 'vitest';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { directoriesOnDevice } from './useProjectDirectory';

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
