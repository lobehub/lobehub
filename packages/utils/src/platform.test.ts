import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isArc, isMacOSWithLargeWindowBorders, isSonomaOrLaterSafari } from './platform';

describe('isSonomaOrLaterSafari', () => {
  beforeEach(() => {
    // 重置 navigator 对象
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
      maxTouchPoints: 0,
    });
  });

  describe('isMacOSWithLargeWindowBorders', () => {
    it('should return true for macOS 10.15+', () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      });

      expect(isMacOSWithLargeWindowBorders()).toBe(true);
    });

    it('should return false for non-macOS userAgent', () => {
      vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0; Win64; x64' });
      expect(isMacOSWithLargeWindowBorders()).toBe(false);
    });

    it('should return false in Electron', () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Electron/30.0.0 Safari/537.36',
      });

      expect(isMacOSWithLargeWindowBorders()).toBe(false);
    });
  });

  it('should return false when userAgent is not Macintosh', () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0; Win64; x64' });
    expect(isSonomaOrLaterSafari()).toBe(false);
  });

  it('should return false when navigator.maxTouchPoints > 0', () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1 });
    expect(isSonomaOrLaterSafari()).toBe(false);
  });

  it('should return false when Safari version < 17', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    });
    expect(isSonomaOrLaterSafari()).toBe(false);
  });

  it('should return false when audio codec check fails', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    vi.spyOn(document, 'createElement').mockReturnValueOnce({
      canPlayType: vi.fn().mockReturnValue(''),
    } as any);
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = vi.fn().mockReturnValueOnce(null);
      },
    );
    expect(isSonomaOrLaterSafari()).toBe(false);
  });

  it('should return false when WebGL check fails', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    vi.spyOn(document, 'createElement').mockReturnValueOnce({
      canPlayType: vi.fn().mockReturnValue('maybe'),
    } as any);
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = vi.fn().mockReturnValueOnce(null);
      },
    );
    expect(isSonomaOrLaterSafari()).toBe(false);
  });

  it('should return true when all checks pass', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    vi.spyOn(document, 'createElement').mockReturnValueOnce({
      canPlayType: vi.fn().mockReturnValue('maybe'),
    } as any);
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = vi.fn().mockReturnValueOnce({});
      },
    );
    expect(isSonomaOrLaterSafari()).toBe(true);
  });

  describe('isArc', () => {
    // 保存原始的 window 对象
    const originalWindow = { ...window };

    beforeEach(() => {
      // 重置 window 对象
      vi.stubGlobal('window', { ...originalWindow });
      // 模拟 matchMedia
      window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    });

    afterEach(() => {
      // 清理所有模拟
      vi.restoreAllMocks();
    });

    it('should return false when on server side', () => {
      vi.mock('./platform', async (importOriginal) => {
        const mod = await importOriginal();

        return {
          // @ts-ignore
          ...mod,
          isOnServerSide: true,
        };
      });
      expect(isArc()).toBe(false);
    });

    it('should return true when CSS custom property matches', () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });
      expect(isArc()).toBe(true);
    });

    it('should return true when "arc" is in window', () => {
      (window as any).arc = {};
      expect(isArc()).toBe(true);
    });

    it('should return true when "ArcControl" is in window', () => {
      (window as any).ArcControl = {};
      expect(isArc()).toBe(true);
    });

    it('should return true when "ARCControl" is in window', () => {
      (window as any).ARCControl = {};
      expect(isArc()).toBe(true);
    });

    it('should return false when none of the conditions are met', () => {
      expect(isArc()).toBe(false);
    });
  });
});
