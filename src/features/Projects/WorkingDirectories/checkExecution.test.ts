import type { ChatTopic } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

import { checkProjectExecution } from './checkExecution';

afterEach(() => vi.restoreAllMocks());
const topic = { id: 'topic', projectWorkingDirectoryId: 'directory' } as ChatTopic;

describe('project send preflight', () => {
  it('allows a plain conversation without a gateway', () => {
    expect(checkProjectExecution(undefined, false)).toBeUndefined();
  });

  it('rejects an unavailable gateway before resolving a device', () => {
    const resolve = vi.spyOn(projectWorkingDirectoryService, 'resolve');
    expect(() => checkProjectExecution(topic, false)).toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  // Regression: the send preflight used to resolve the directory and probe it
  // with `deviceService.statPath` on every send — a full device round trip (up
  // to its 8s timeout) that could reject the message outright when the device
  // was merely slow to answer. Liveness is the dispatch's to discover.
  it('does not probe the device on the send path when the gateway is enabled', () => {
    const resolve = vi.spyOn(projectWorkingDirectoryService, 'resolve').mockResolvedValue({
      data: { deviceId: 'pinned-device', path: '/project' },
      success: true,
    } as Awaited<ReturnType<typeof projectWorkingDirectoryService.resolve>>);
    const stat = vi
      .spyOn(deviceService, 'statPath')
      .mockResolvedValue({ exists: true, isDirectory: true });

    expect(checkProjectExecution(topic, true)).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });
});
