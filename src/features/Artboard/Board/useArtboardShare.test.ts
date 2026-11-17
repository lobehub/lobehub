import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArtboardShareState, useArtboardShareTrigger } from './useArtboardShare';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  copyToClipboard: vi.fn(),
  openPublishConfirm: vi.fn(),
  publish: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  unpublish: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
  copyToClipboard: mocks.copyToClipboard,
  toast: mocks.toast,
}));
vi.mock('@/components/PublishConfirmModal', () => ({
  openPublishConfirm: mocks.openPublishConfirm,
}));
vi.mock('@/services/artboard', () => ({
  artboardService: { publish: mocks.publish, unpublish: mocks.unpublish },
}));

const state = (overrides: Partial<ArtboardShareState> = {}): ArtboardShareState => ({
  canPublish: true,
  hasUpdates: false,
  publishedUrl: null,
  ...overrides,
});

const trigger = (value: ArtboardShareState | undefined, refresh = vi.fn()) =>
  renderHook(() => useArtboardShareTrigger('art_1', value, refresh)).result.current;

const keysOf = (value: ReturnType<typeof trigger>) =>
  value.kind === 'menu' ? value.items.map((item) => item.key) : [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publish.mockResolvedValue({ url: 'https://onboarding.lobe.page' });
  mocks.unpublish.mockResolvedValue(undefined);
});

describe('useArtboardShareTrigger', () => {
  it('offers nothing to someone who cannot share the board', () => {
    expect(trigger(undefined).kind).toBe('none');
    expect(trigger(state({ canPublish: false })).kind).toBe('none');
  });

  it('asks before the board becomes public, then copies the link', async () => {
    const refresh = vi.fn();
    const value = trigger(state(), refresh);
    if (value.kind !== 'action') throw new Error('expected a single share action');

    act(() => value.action.onClick());
    expect(mocks.publish).not.toHaveBeenCalled();
    const [{ onOk }] = mocks.openPublishConfirm.mock.calls[0];
    await act(async () => onOk());

    expect(mocks.publish).toHaveBeenCalledWith('art_1');
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('https://onboarding.lobe.page');
    expect(refresh).toHaveBeenCalled();
  });

  it('puts updating first once the board has changed since it was shared', () => {
    expect(keysOf(trigger(state({ hasUpdates: true, publishedUrl: 'https://x' })))).toEqual([
      'update',
      'open',
      'copy',
      'unpublish',
    ]);
    expect(keysOf(trigger(state({ publishedUrl: 'https://x' })))).toEqual([
      'open',
      'copy',
      'unpublish',
    ]);
  });

  it('confirms before taking the share down', async () => {
    const refresh = vi.fn();
    const value = trigger(state({ publishedUrl: 'https://x' }), refresh);
    if (value.kind !== 'menu') throw new Error('expected a menu');

    act(() => value.items.find((item) => item.key === 'unpublish')!.onClick());
    expect(mocks.unpublish).not.toHaveBeenCalled();
    const [{ onOk }] = mocks.confirmModal.mock.calls[0];
    await act(async () => onOk());

    expect(mocks.unpublish).toHaveBeenCalledWith('art_1');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the reason the server gave when sharing is refused', async () => {
    mocks.publish.mockRejectedValue(
      Object.assign(new Error('Board "Pricing" points at a Canvas version that is gone'), {
        data: { code: 'PRECONDITION_FAILED' },
      }),
    );
    const value = trigger(state());
    if (value.kind !== 'action') throw new Error('expected a single share action');

    act(() => value.action.onClick());
    const [{ onOk }] = mocks.openPublishConfirm.mock.calls[0];
    await act(async () => onOk());

    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Board "Pricing" points at a Canvas version that is gone',
    );
  });

  it('keeps the generic message for an unexpected failure', async () => {
    mocks.publish.mockRejectedValue(
      Object.assign(new Error('Artboard failed'), { data: { code: 'INTERNAL_SERVER_ERROR' } }),
    );
    const value = trigger(state());
    if (value.kind !== 'action') throw new Error('expected a single share action');

    act(() => value.action.onClick());
    const [{ onOk }] = mocks.openPublishConfirm.mock.calls[0];
    await act(async () => onOk());

    expect(mocks.toast.error).toHaveBeenCalledWith('artboard.share.failed');
  });
});
