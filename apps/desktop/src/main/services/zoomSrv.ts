import type { WebContents } from 'electron';

import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

export const ZOOM_FACTOR_MIN = 0.5;
export const ZOOM_FACTOR_MAX = 1.75;

export type ZoomAction = 'in' | 'out' | 'reset';

const ELECTRON_ZOOM_BASE = 1.2;
const ZOOM_FACTOR_EPSILON = 0.001;
const ZOOM_FACTOR_PRESETS = [
  ZOOM_FACTOR_MIN,
  2 / 3,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  ZOOM_FACTOR_MAX,
] as const;

const logger = createLogger('services:ZoomService');

const getAdjacentZoomFactor = (current: number, action: Exclude<ZoomAction, 'reset'>): number => {
  const next =
    action === 'in'
      ? ZOOM_FACTOR_PRESETS.find((factor) => factor > current + ZOOM_FACTOR_EPSILON)
      : ZOOM_FACTOR_PRESETS.findLast((factor) => factor < current - ZOOM_FACTOR_EPSILON);

  return next ?? current;
};

export default class ZoomService extends ServiceModule {
  apply(action: ZoomAction, webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed()) return;

    const current = webContents.getZoomFactor();
    const next = action === 'reset' ? 1 : getAdjacentZoomFactor(current, action);

    if (next !== current) {
      webContents.setZoomFactor(next);
      logger.debug(`Zoom ${action}: factor ${current} -> ${next}`);
    }

    this.broadcast(webContents, next);
  }

  private broadcast(webContents: WebContents, factor: number): void {
    const level = Number((Math.log(factor) / Math.log(ELECTRON_ZOOM_BASE)).toFixed(4));

    try {
      webContents.send('zoom:changed', { factor, level });
    } catch (error) {
      logger.warn('Failed to broadcast zoom:changed', error);
    }
  }
}
