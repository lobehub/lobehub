import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as platformUtils from '@/utils/platform';

import { usePlatform } from './usePlatform';

// Mocks
vi.mock('@/utils/platform', () => ({
  getBrowser: vi.fn(),
  getPlatform: vi.fn(),
  isInStandaloneMode: vi.fn(),
  isSonomaOrLaterSafari: vi.fn(),
  isArc: vi.fn(),
}));

describe('usePlatform', () => {
  it('should return correct platform info for Mac OS and Chrome', () => {
    vi.mocked(platformUtils.getPlatform).mockReturnValue('Mac OS');
    vi.mocked(platformUtils.getBrowser).mockReturnValue('Chrome');
    vi.mocked(platformUtils.isArc).mockReturnValue(false);
    vi.mocked(platformUtils.isInStandaloneMode).mockReturnValue(false);
    vi.mocked(platformUtils.isSonomaOrLaterSafari).mockReturnValue(false);

    const { result } = renderHook(() => usePlatform());

    expect(result.current).toEqual({
      isAndroid: false,
      isApple: true,
      isChrome: true,
      isChromium: true,
      isEdge: false,
      isFirefox: false,
      isIOS: false,
      isMacOS: true,
      isPWA: false,
      isSafari: false,
      isArc: false,
      isSonomaOrLaterSafari: false,
      isSupportInstallPWA: true,
    });
  });

  it('should return correct platform info for iOS and Safari', () => {
    vi.mocked(platformUtils.getPlatform).mockReturnValue('iOS');
    vi.mocked(platformUtils.getBrowser).mockReturnValue('Safari');
    vi.mocked(platformUtils.isArc).mockReturnValue(false);
    vi.mocked(platformUtils.isInStandaloneMode).mockReturnValue(true);
    vi.mocked(platformUtils.isSonomaOrLaterSafari).mockReturnValue(true);

    const { result } = renderHook(() => usePlatform());

    expect(result.current).toEqual({
      isAndroid: false,
      isApple: true,
      isChrome: false,
      isChromium: false,
      isEdge: false,
      isArc: false,
      isFirefox: false,
      isIOS: true,
      isMacOS: false,
      isPWA: true,
      isSafari: true,
      isSonomaOrLaterSafari: true,
      isSupportInstallPWA: false,
    });
  });

  it('should return correct platform info for Windows and Edge', () => {
    vi.mocked(platformUtils.getPlatform).mockReturnValue('Windows');
    vi.mocked(platformUtils.getBrowser).mockReturnValue('Edge');
    vi.mocked(platformUtils.isArc).mockReturnValue(false);
    vi.mocked(platformUtils.isInStandaloneMode).mockReturnValue(false);
    vi.mocked(platformUtils.isSonomaOrLaterSafari).mockReturnValue(false);

    const { result } = renderHook(() => usePlatform());

    expect(result.current).toEqual({
      isAndroid: false,
      isApple: false,
      isChrome: false,
      isChromium: true,
      isEdge: true,
      isFirefox: false,
      isIOS: false,
      isMacOS: false,
      isArc: false,
      isPWA: false,
      isSafari: false,
      isSonomaOrLaterSafari: false,
      isSupportInstallPWA: true,
    });
  });

  it('should return correct platform info for Firefox', () => {
    vi.mocked(platformUtils.getPlatform).mockReturnValue('Windows');
    vi.mocked(platformUtils.getBrowser).mockReturnValue('Firefox');
    vi.mocked(platformUtils.isArc).mockReturnValue(false);
    vi.mocked(platformUtils.isInStandaloneMode).mockReturnValue(false);
    vi.mocked(platformUtils.isSonomaOrLaterSafari).mockReturnValue(false);

    const { result } = renderHook(() => usePlatform());

    expect(result.current).toEqual({
      isAndroid: false,
      isApple: false,
      isChrome: false,
      isChromium: false,
      isEdge: false,
      isFirefox: true,
      isIOS: false,
      isMacOS: false,
      isArc: false,
      isPWA: false,
      isSafari: false,
      isSonomaOrLaterSafari: false,
      isSupportInstallPWA: false,
    });
  });

  it('should return correct platform info for Arc', () => {
    vi.mocked(platformUtils.getPlatform).mockReturnValue('Mac OS');
    vi.mocked(platformUtils.getBrowser).mockReturnValue('Chrome');
    vi.mocked(platformUtils.isArc).mockReturnValue(true);
    vi.mocked(platformUtils.isInStandaloneMode).mockReturnValue(false);
    vi.mocked(platformUtils.isSonomaOrLaterSafari).mockReturnValue(false);

    const { result } = renderHook(() => usePlatform());

    expect(result.current).toEqual({
      isAndroid: false,
      isApple: true,
      isChrome: true,
      isChromium: true,
      isEdge: false,
      isFirefox: false,
      isIOS: false,
      isMacOS: true,
      isArc: true,
      isPWA: false,
      isSafari: false,
      isSonomaOrLaterSafari: false,
      isSupportInstallPWA: false,
    });
  });
});
