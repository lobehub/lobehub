import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';

import { useTopicShare } from './useTopicShare';

vi.mock('@/services/topic', () => ({
  topicService: {
    enableSharing: vi.fn(),
    getShareInfo: vi.fn(),
    updateShareVisibility: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const renderShare = async () => {
  const hook = renderHook(() => useTopicShare('topic-1', true), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
};

describe('useTopicShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a topic without a share record as private and does not create one on load', async () => {
    vi.mocked(topicService.getShareInfo).mockResolvedValue(null as any);

    const { result } = await renderShare();

    expect(result.current.visibility).toBe('private');
    expect(topicService.enableSharing).not.toHaveBeenCalled();
  });

  it('creates the share record with the requested visibility on the first change', async () => {
    vi.mocked(topicService.getShareInfo).mockResolvedValue(null as any);
    vi.mocked(topicService.enableSharing).mockResolvedValue({
      id: 'share-1',
      visibility: 'link',
    } as any);

    const { result } = await renderShare();
    let shareId: string | undefined;
    await act(async () => {
      shareId = await result.current.setVisibility('link');
    });

    expect(shareId).toBe('share-1');
    expect(topicService.enableSharing).toHaveBeenCalledWith('topic-1', 'link');
    expect(topicService.updateShareVisibility).not.toHaveBeenCalled();
  });

  it('applies the visibility when create returns a record that already existed', async () => {
    vi.mocked(topicService.getShareInfo).mockResolvedValue(null as any);
    vi.mocked(topicService.enableSharing).mockResolvedValue({
      id: 'share-1',
      visibility: 'private',
    } as any);
    vi.mocked(topicService.updateShareVisibility).mockResolvedValue({
      id: 'share-1',
      visibility: 'link',
    } as any);

    const { result } = await renderShare();
    await act(async () => {
      await result.current.setVisibility('link');
    });

    expect(topicService.updateShareVisibility).toHaveBeenCalledWith('topic-1', 'link');
  });

  it('updates an existing share record instead of creating one', async () => {
    vi.mocked(topicService.getShareInfo).mockResolvedValue({
      id: 'share-1',
      visibility: 'private',
    } as any);
    vi.mocked(topicService.updateShareVisibility).mockResolvedValue({
      id: 'share-1',
      visibility: 'link',
    } as any);

    const { result } = await renderShare();
    await waitFor(() => expect(result.current.shareInfo).toBeTruthy());
    await act(async () => {
      await result.current.setVisibility('link');
    });

    expect(topicService.updateShareVisibility).toHaveBeenCalledWith('topic-1', 'link');
    expect(topicService.enableSharing).not.toHaveBeenCalled();
  });
});
