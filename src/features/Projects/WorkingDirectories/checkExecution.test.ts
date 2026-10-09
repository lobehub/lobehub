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
  it('rejects an unavailable gateway before resolving a device', async () => {
    const resolve = vi.spyOn(projectWorkingDirectoryService, 'resolve');
    await expect(checkProjectExecution(topic, false)).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });
  it('rejects offline devices and recovers only when the actual directory exists', async () => {
    vi.spyOn(projectWorkingDirectoryService, 'resolve').mockResolvedValue({
      data: { deviceId: 'pinned-device', path: '/project' },
      success: true,
    } as Awaited<ReturnType<typeof projectWorkingDirectoryService.resolve>>);
    const stat = vi
      .spyOn(deviceService, 'statPath')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ exists: true, isDirectory: true });
    await expect(checkProjectExecution(topic, true)).rejects.toThrow();
    await expect(checkProjectExecution(topic, true)).resolves.toBeUndefined();
    expect(stat).toHaveBeenLastCalledWith('pinned-device', '/project');
  });
});
