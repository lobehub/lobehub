import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBindDirectory } from './useBindDirectory';

const { bind, refreshTopic } = vi.hoisted(() => ({ bind: vi.fn(), refreshTopic: vi.fn() }));
vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: (selector: (s: { bind: typeof bind }) => unknown) => selector({ bind }),
}));
vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => ({ refreshTopic }) } }));
const options = {
  agentId: 'writer',
  deviceId: 'laptop',
  path: '/work/docs',
  topicIds: ['old-1', 'old-2'],
};
describe('binding an Agent directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bind.mockResolvedValue({ id: 'binding' });
  });
  it('files every supplied existing topic automatically and refreshes before closing', async () => {
    const saved = vi.fn();
    const { result } = renderHook(() => useBindDirectory(options, saved));
    await act(async () => result.current.save('project', 'environment'));
    expect(bind).toHaveBeenCalledWith(
      expect.objectContaining({
        topicIds: ['old-1', 'old-2'],
        deviceId: 'laptop',
        path: '/work/docs',
        projectId: 'project',
      }),
    );
    expect(refreshTopic).toHaveBeenCalled();
    expect(saved).toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
  it('keeps the form open and supports retry when association fails', async () => {
    const error = new Error('Wait for conversation to finish');
    bind.mockRejectedValueOnce(error);
    const saved = vi.fn();
    const { result } = renderHook(() => useBindDirectory(options, saved));
    await act(async () => result.current.save('project', 'environment'));
    expect(result.current.error).toBe(error);
    expect(result.current.pending).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    expect(refreshTopic).not.toHaveBeenCalled();
    await act(async () => result.current.save('project', 'environment'));
    expect(result.current.error).toBeUndefined();
    expect(saved).toHaveBeenCalledOnce();
  });
});
