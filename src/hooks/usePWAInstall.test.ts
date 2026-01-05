import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';

import { usePWAInstall } from './usePWAInstall';
import { usePlatform } from './usePlatform';

// Mocks
vi.mock('./usePlatform', () => ({
  usePlatform: vi.fn(),
}));

vi.mock('@/utils/env', () => ({
  isOnServerSide: false,
}));

describe('usePWAInstall', () => {
  let mockPWAElement: any;

  beforeEach(() => {
    // Create mock PWA element
    mockPWAElement = {
      isInstallAvailable: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      showDialog: vi.fn(),
      externalPromptEvent: undefined,
    };
    document.body.innerHTML = `<div id="${PWA_INSTALL_ID}"></div>`;
    const pwaElement = document.querySelector(`#${PWA_INSTALL_ID}`)!;
    Object.assign(pwaElement, mockPWAElement);
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    delete (window as any).pwaPromptEvent;
  });

  it('should return canInstall as false when in PWA', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: true } as any);

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(false);
  });

  it('should return canInstall as false when not support PWA', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: false, isPWA: false } as any);

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(false);
  });

  it('should return canInstall as true when isInstallAvailable is true initially', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    // Set the property on the actual DOM element
    const pwaElement: any = document.querySelector(`#${PWA_INSTALL_ID}`);
    pwaElement.isInstallAvailable = true;

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(true);
  });

  it('should listen to pwa-install-available-event and update canInstall', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    const { result, rerender } = renderHook(() => usePWAInstall());

    expect(result.current.canInstall).toBe(false);
    expect(mockPWAElement.addEventListener).toHaveBeenCalledWith(
      'pwa-install-available-event',
      expect.any(Function),
    );

    // Simulate the event being fired
    const eventHandler = mockPWAElement.addEventListener.mock.calls[0][1];
    act(() => {
      eventHandler();
    });

    rerender();

    expect(result.current.canInstall).toBe(true);
  });

  it('should pass window.pwaPromptEvent to pwa.externalPromptEvent if available', () => {
    const mockPromptEvent = { preventDefault: vi.fn() };
    (window as any).pwaPromptEvent = mockPromptEvent;
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    renderHook(() => usePWAInstall());

    const pwaElement: any = document.querySelector(`#${PWA_INSTALL_ID}`);
    expect(pwaElement.externalPromptEvent).toBe(mockPromptEvent);
  });

  it('should remove event listener on unmount', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    const { unmount } = renderHook(() => usePWAInstall());

    unmount();

    expect(mockPWAElement.removeEventListener).toHaveBeenCalledWith(
      'pwa-install-available-event',
      expect.any(Function),
    );
  });

  it('should call pwa.showDialog when install is called', () => {
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      result.current.install();
    });

    expect(mockPWAElement.showDialog).toHaveBeenCalledWith(true);
  });

  it('should not crash if PWA element is not found when calling install', () => {
    document.body.innerHTML = '';
    vi.mocked(usePlatform).mockReturnValue({ isSupportInstallPWA: true, isPWA: false } as any);

    const { result } = renderHook(() => usePWAInstall());

    expect(() => {
      result.current.install();
    }).not.toThrow();
  });
});
