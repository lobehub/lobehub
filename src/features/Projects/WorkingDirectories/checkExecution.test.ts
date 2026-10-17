import type { ChatTopic } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { type ProjectDirectory, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { checkProjectExecution } from './checkExecution';

afterEach(() => vi.restoreAllMocks());
const topic = { id: 'topic', projectWorkingDirectoryId: 'directory' } as ChatTopic;

describe('project send preflight', () => {
  it('allows a plain conversation without a gateway', async () => {
    await expect(checkProjectExecution(undefined, false)).resolves.toBeUndefined();
  });

  it('rejects an unavailable gateway before resolving the directory', async () => {
    const resolve = vi.spyOn(projectWorkingDirectoryService, 'resolve');
    await expect(checkProjectExecution(topic, false)).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a directory that was deleted, unlinked or made read-only while open', async () => {
    vi.spyOn(projectWorkingDirectoryService, 'resolve').mockRejectedValue(
      new Error('Project directory not found'),
    );

    // The composer is cleared only after this resolves, so the rejection is what
    // keeps the user's text and uploads.
    await expect(checkProjectExecution(topic, true)).rejects.toThrow('Project directory not found');
  });

  // Regression: the preflight used to probe the directory with
  // `deviceService.statPath` on every send — a full device round trip (up to its
  // 8s timeout) that could reject the message when the device was merely slow to
  // answer. Liveness is the dispatch's to discover; only the DB resolve stays.
  it('does not probe the device on the send path when the gateway is enabled', async () => {
    const resolve = vi.spyOn(projectWorkingDirectoryService, 'resolve').mockResolvedValue({
      data: { deviceId: 'pinned-device', path: '/project' },
      success: true,
    } as Awaited<ReturnType<typeof projectWorkingDirectoryService.resolve>>);
    const stat = vi.spyOn(deviceService, 'statPath');

    await checkProjectExecution(topic, true);

    expect(resolve).toHaveBeenCalledWith('directory');
    expect(stat).not.toHaveBeenCalled();
  });

  // Regression: the DB resolve held every project send behind a network round
  // trip before the composer even cleared. The sidebar's directory replica
  // already carries the binding, so a loaded row is checked locally.
  describe('with the directory row in the local replica', () => {
    const row = {
      deviceId: 'pinned-device',
      environmentId: 'env',
      id: 'directory',
      instanceId: 'instance',
      permission: 'readWrite',
      projectId: 'project',
    } as ProjectDirectory;

    afterEach(() => useProjectDirectoryStore.setState({ directoriesMap: {} }));

    it('passes without resolving over the network', async () => {
      useProjectDirectoryStore.setState({ directoriesMap: { all: [row] } });
      const resolve = vi.spyOn(projectWorkingDirectoryService, 'resolve');

      await expect(checkProjectExecution(topic, true)).resolves.toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
    });

    // Regression: a cached unlinked/read-only row was rejected locally, but the
    // replica can lag a change (`attachEnvironment` refreshes only environments),
    // so a send the server would accept was blocked. Negative states re-resolve.
    it.each([
      ['unlinked', { environmentId: null, instanceId: null }],
      ['read-only', { permission: 'read' }],
    ])('re-resolves a cached %s row and passes when the server accepts it', async (_, patch) => {
      useProjectDirectoryStore.setState({
        directoriesMap: { all: [{ ...row, ...patch } as ProjectDirectory] },
      });
      const resolve = vi
        .spyOn(projectWorkingDirectoryService, 'resolve')
        .mockResolvedValue({ data: row, success: true } as any);

      await expect(checkProjectExecution(topic, true)).resolves.toBeUndefined();
      expect(resolve).toHaveBeenCalledWith('directory');
    });

    it('rejects a cached negative row the server still refuses', async () => {
      useProjectDirectoryStore.setState({
        directoriesMap: { all: [{ ...row, permission: 'read' } as ProjectDirectory] },
      });
      vi.spyOn(projectWorkingDirectoryService, 'resolve').mockRejectedValue(
        new Error('This directory is read-only'),
      );

      await expect(checkProjectExecution(topic, true)).rejects.toThrow(
        'This directory is read-only',
      );
    });
  });
});
