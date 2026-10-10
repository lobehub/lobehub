import type { ChatTopic } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

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
});
