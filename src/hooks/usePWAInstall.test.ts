import { act, renderHook } from '@testing-library/react';
import { pwaInstallHandler } from 'pwa-install-handler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';

import { usePlatform } from './usePlatform';
import { usePWAInstall } from './usePWAInstall';

// Mocks
vi.mock('./usePlatform', () => ({
  usePlatform: vi.fn(),
}));

vi.mock('@/utils/env', () => ({
  isOnServerSide: false,
}));

vi.mock('pwa-install-handler', () => ({
  pwaInstallHandler: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    getEvent: vi.fn(),
  },
}));

describe('usePWAInstall', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return canInstall as false when in PWA', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: true } as any);

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(false);
  });

  it('should return canInstall based on canInstall state when support PWA', () => {
    document.body.innerHTML = `<div id="${PWA_INSTALL_ID}"></div>`;
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    const { result, rerender } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(false);

    act(() => {
      vi.mocked(pwaInstallHandler.addListener).mock.calls[0][0](true);
    });

    rerender();

    expect(result.current.canInstall).toBe(true);
  });

  it('should return canInstall as false when not support PWA', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: false, isPWA: false } as any);

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(false);
  });

  it('should call pwa.showDialog when install is called', () => {
    const mockShowDialog = vi.fn();
    document.body.innerHTML = `<div id="${PWA_INSTALL_ID}"></div>`;
    const pwaElement: any = document.querySelector(`#${PWA_INSTALL_ID}`);
    pwaElement.showDialog = mockShowDialog;

    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      result.current.install();
    });

    expect(mockShowDialog).toHaveBeenCalledWith(true);
  });
});
