import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import { WindowStateManager } from '../WindowStateManager';

// Use vi.hoisted to define mocks before hoisting
const { mockScreen } = vi.hoisted(() => ({
  mockScreen: {
    getDisplayMatching: vi.fn().mockReturnValue({
      workArea: { height: 1080, width: 1920, x: 0, y: 0 },
    }),
    getPrimaryDisplay: vi.fn().mockReturnValue({
      workArea: { height: 1080, width: 1920, x: 0, y: 0 },
    }),
  },
}));

vi.mock('electron', () => ({
  screen: mockScreen,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('WindowStateManager', () => {
  let manager: WindowStateManager;
  let mockApp: AppCore;
  let mockStoreManagerGet: ReturnType<typeof vi.fn>;
  let mockStoreManagerSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStoreManagerGet = vi.fn().mockReturnValue(undefined);
    mockStoreManagerSet = vi.fn();

    mockApp = {
      isQuiting: false,
      storeManager: {
        get: mockStoreManagerGet,
        set: mockStoreManagerSet,
      },
    } as unknown as AppCore;

    manager = new WindowStateManager(mockApp, {
      identifier: 'test-window',
      keepAlive: false,
    });
  });

  describe('loadState', () => {
    it('should load state from store', () => {
      const savedState = { height: 700, width: 900, x: 100, y: 100 };
      mockStoreManagerGet.mockReturnValue(savedState);

      const state = manager.loadState();

      expect(mockStoreManagerGet).toHaveBeenCalledWith('windowSize_test-window');
      expect(state).toEqual(savedState);
    });

    it('should return undefined when no saved state', () => {
      mockStoreManagerGet.mockReturnValue(undefined);

      const state = manager.loadState();

      expect(state).toBeUndefined();
    });
  });

  describe('saveState', () => {
    it('should save window bounds to store', () => {
      const mockBrowserWindow = {
        getBounds: vi.fn().mockReturnValue({ height: 600, width: 800, x: 50, y: 50 }),
      } as any;

      manager.saveState(mockBrowserWindow, 'close');

      expect(mockStoreManagerSet).toHaveBeenCalledWith('windowSize_test-window', {
        height: 600,
        width: 800,
        x: 50,
        y: 50,
      });
    });

    it('should handle errors gracefully', () => {
      const mockBrowserWindow = {
        getBounds: vi.fn().mockImplementation(() => {
          throw new Error('Window destroyed');
        }),
      } as any;

      // Should not throw
      expect(() => manager.saveState(mockBrowserWindow, 'close')).not.toThrow();
    });
  });

  describe('resolveState', () => {
    it('should use fallback when no saved state', () => {
      mockStoreManagerGet.mockReturnValue(undefined);

      const state = manager.resolveState({ height: 600, width: 800 });

      expect(state).toEqual({ height: 600, width: 800 });
    });

    it('should use saved size over fallback', () => {
      mockStoreManagerGet.mockReturnValue({ height: 700, width: 900 });

      const state = manager.resolveState({ height: 600, width: 800 });

      expect(state).toEqual({ height: 700, width: 900 });
    });

    it('should restore saved position when valid', () => {
      mockStoreManagerGet.mockReturnValue({ height: 700, width: 900, x: 100, y: 100 });

      const state = manager.resolveState({ height: 600, width: 800 });

      expect(state).toEqual({ height: 700, width: 900, x: 100, y: 100 });
    });

    it('should clamp position to screen bounds', () => {
      mockStoreManagerGet.mockReturnValue({ height: 700, width: 900, x: 2000, y: 1500 });

      const state = manager.resolveState({ height: 600, width: 800 });

      // x should be clamped: maxX = 0 + max(0, 1920 - 900) = 1020
      // y should be clamped: maxY = 0 + max(0, 1080 - 700) = 380
      expect(state.x).toBe(1020);
      expect(state.y).toBe(380);
    });

    it('should clamp size to screen bounds', () => {
      mockScreen.getDisplayMatching.mockReturnValueOnce({
        workArea: { height: 800, width: 1200, x: 0, y: 0 },
      });
      mockStoreManagerGet.mockReturnValue({ height: 1200, width: 2000, x: 0, y: 0 });

      const state = manager.resolveState({ height: 600, width: 800 });

      expect(state.width).toBe(1200);
      expect(state.height).toBe(800);
    });

    it('should use primary display when no matching display found', () => {
      mockScreen.getDisplayMatching.mockReturnValueOnce(null);
      mockStoreManagerGet.mockReturnValue({ height: 700, width: 900, x: 100, y: 100 });

      const state = manager.resolveState({ height: 600, width: 800 });

      expect(mockScreen.getPrimaryDisplay).toHaveBeenCalled();
      expect(state).toBeDefined();
    });
  });

  describe('createCloseHandler', () => {
    let mockBrowserWindow: any;
    let onCleanup: ReturnType<typeof vi.fn>;
    let onHide: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockBrowserWindow = {
        getBounds: vi.fn().mockReturnValue({ height: 600, width: 800, x: 0, y: 0 }),
      };
      onCleanup = vi.fn();
      onHide = vi.fn();
    });

    describe('when app is quitting', () => {
      beforeEach(() => {
        (mockApp as any).isQuiting = true;
      });

      it('should save state and call cleanup', () => {
        const handler = manager.createCloseHandler(mockBrowserWindow, { onCleanup, onHide });
        const mockEvent = { preventDefault: vi.fn() };

        handler(mockEvent as any);

        expect(mockStoreManagerSet).toHaveBeenCalledWith('windowSize_test-window', {
          height: 600,
          width: 800,
          x: 0,
          y: 0,
        });
        expect(onCleanup).toHaveBeenCalled();
        expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      });
    });

    describe('when keepAlive is true', () => {
      beforeEach(() => {
        manager = new WindowStateManager(mockApp, {
          identifier: 'test-window',
          keepAlive: true,
        });
      });

      it('should prevent close and call hide', () => {
        const handler = manager.createCloseHandler(mockBrowserWindow, { onCleanup, onHide });
        const mockEvent = { preventDefault: vi.fn() };

        handler(mockEvent as any);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(onHide).toHaveBeenCalled();
        expect(mockStoreManagerSet).not.toHaveBeenCalled();
      });
    });

    describe('when keepAlive is false (normal close)', () => {
      it('should save state and call cleanup', () => {
        const handler = manager.createCloseHandler(mockBrowserWindow, { onCleanup, onHide });
        const mockEvent = { preventDefault: vi.fn() };

        handler(mockEvent as any);

        expect(mockStoreManagerSet).toHaveBeenCalledWith('windowSize_test-window', {
          height: 600,
          width: 800,
          x: 0,
          y: 0,
        });
        expect(onCleanup).toHaveBeenCalled();
        expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      });
    });
  });
});
