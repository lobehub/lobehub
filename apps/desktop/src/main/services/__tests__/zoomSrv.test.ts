import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import ZoomService, { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../zoomSrv';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

interface MockWebContents {
  destroyed: boolean;
  getZoomLevel: () => number;
  isDestroyed: () => boolean;
  level: number;
  send: ReturnType<typeof vi.fn>;
  setZoomLevel: (level: number) => void;
}

const createMockWebContents = (initialLevel = 0): MockWebContents => {
  const wc: MockWebContents = {
    destroyed: false,
    level: initialLevel,
    getZoomLevel: () => wc.level,
    isDestroyed: () => wc.destroyed,
    send: vi.fn(),
    setZoomLevel: (level: number) => {
      wc.level = level;
    },
  };
  return wc;
};

describe('ZoomService', () => {
  let service: ZoomService;

  beforeEach(() => {
    service = new ZoomService({} as App);
  });

  it('increments zoom level by 1 on action=in', () => {
    const wc = createMockWebContents(0);
    service.apply('in', wc as any);
    expect(wc.level).toBe(1);
    expect(wc.send).toHaveBeenCalledWith('zoom:changed', { factor: 1.2, level: 1 });
  });

  it('decrements zoom level by 1 on action=out', () => {
    const wc = createMockWebContents(0);
    service.apply('out', wc as any);
    expect(wc.level).toBe(-1);
    expect(wc.send).toHaveBeenCalledWith('zoom:changed', {
      factor: Number((1.2 ** -1).toFixed(4)),
      level: -1,
    });
  });

  it('resets to 0 on action=reset', () => {
    const wc = createMockWebContents(2);
    service.apply('reset', wc as any);
    expect(wc.level).toBe(0);
    expect(wc.send).toHaveBeenCalledWith('zoom:changed', { factor: 1, level: 0 });
  });

  it('clamps at ZOOM_LEVEL_MAX and still broadcasts current level', () => {
    const wc = createMockWebContents(ZOOM_LEVEL_MAX);
    service.apply('in', wc as any);
    expect(wc.level).toBe(ZOOM_LEVEL_MAX);
    expect(wc.send).toHaveBeenCalledWith('zoom:changed', {
      factor: Number((1.2 ** ZOOM_LEVEL_MAX).toFixed(4)),
      level: ZOOM_LEVEL_MAX,
    });
  });

  it('clamps at ZOOM_LEVEL_MIN and still broadcasts current level', () => {
    const wc = createMockWebContents(ZOOM_LEVEL_MIN);
    service.apply('out', wc as any);
    expect(wc.level).toBe(ZOOM_LEVEL_MIN);
    expect(wc.send).toHaveBeenCalledWith('zoom:changed', {
      factor: Number((1.2 ** ZOOM_LEVEL_MIN).toFixed(4)),
      level: ZOOM_LEVEL_MIN,
    });
  });

  it('skips when webContents is destroyed', () => {
    const wc = createMockWebContents(0);
    wc.destroyed = true;
    service.apply('in', wc as any);
    expect(wc.level).toBe(0);
    expect(wc.send).not.toHaveBeenCalled();
  });

  it('factor matches 1.2 ** level for reset', () => {
    const wc = createMockWebContents(0);
    service.apply('reset', wc as any);
    const payload = wc.send.mock.calls[0][1];
    expect(payload.factor).toBe(1);
  });
});
