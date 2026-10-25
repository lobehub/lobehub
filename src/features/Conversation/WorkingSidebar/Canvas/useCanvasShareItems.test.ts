import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasVersionDetail } from '@/services/canvas';

import { useCanvasShareItems } from './useCanvasShareItems';

const mocks = vi.hoisted(() => ({
  openPublishConfirm: vi.fn(),
  publish: vi.fn(),
  refreshAllConversations: vi.fn(),
}));

vi.mock('@/components/PublishConfirmModal', () => ({
  openPublishConfirm: mocks.openPublishConfirm,
}));
vi.mock('@/services/canvas', () => ({ canvasService: { publish: mocks.publish } }));
vi.mock('@/services/work', () => ({
  workService: { refreshAllConversations: mocks.refreshAllConversations },
}));

const detail = (overrides: Partial<CanvasVersionDetail> = {}) =>
  ({
    canPublish: true,
    canvasId: 'cvs_1',
    latestVersion: 2,
    publishedUrl: null,
    publishedVersion: null,
    ...overrides,
  }) as unknown as CanvasVersionDetail;

const clickShare = (data: CanvasVersionDetail, onShared = vi.fn()) => {
  const { result } = renderHook(() => useCanvasShareItems(data, onShared));
  const item = result.current.find((entry) => 'key' in entry && entry.key === 'share');
  if (!item || !('onClick' in item) || typeof item.onClick !== 'function') {
    throw new Error('the share item was not offered');
  }
  act(() => {
    item.onClick?.();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publish.mockResolvedValue({ publishedVersion: 2 });
});

describe('useCanvasShareItems', () => {
  it('asks for confirmation before a canvas becomes public', () => {
    clickShare(detail());

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.openPublishConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ okText: 'canvas.share.publish', note: 'canvas.share.note' }),
    );
  });

  it('publishes once the confirmation is accepted', async () => {
    const onShared = vi.fn();
    clickShare(detail(), onShared);

    await act(async () => {
      mocks.openPublishConfirm.mock.calls[0][0].onOk();
    });

    expect(mocks.publish).toHaveBeenCalledWith('cvs_1');
    expect(onShared).toHaveBeenCalled();
  });

  it('confirms updating an existing share as well', () => {
    clickShare(detail({ publishedUrl: 'https://cost.lobehub.sites', publishedVersion: 1 }));

    expect(mocks.openPublishConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ okText: 'canvas.share.update' }),
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('offers the share link only after the canvas is public', () => {
    const { result: unshared } = renderHook(() => useCanvasShareItems(detail(), vi.fn()));
    expect(unshared.current.some((item) => 'key' in item && item.key === 'open-public')).toBe(
      false,
    );

    const { result: shared } = renderHook(() =>
      useCanvasShareItems(
        detail({ publishedUrl: 'https://cost.lobehub.sites', publishedVersion: 2 }),
        vi.fn(),
      ),
    );
    expect(shared.current.some((item) => 'key' in item && item.key === 'open-public')).toBe(true);
  });

  it('has nothing to offer for an unshared canvas the viewer cannot share', () => {
    const { result } = renderHook(() =>
      useCanvasShareItems(detail({ canPublish: false }), vi.fn()),
    );

    expect(result.current).toHaveLength(0);
  });
});
