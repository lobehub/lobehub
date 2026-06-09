import type { WebContents } from 'electron';

import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

export const ZOOM_LEVEL_MIN = -3;
export const ZOOM_LEVEL_MAX = 3;

export type ZoomAction = 'in' | 'out' | 'reset';

const logger = createLogger('services:ZoomService');

export default class ZoomService extends ServiceModule {
  apply(action: ZoomAction, webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed()) return;

    const current = webContents.getZoomLevel();
    const next =
      action === 'reset'
        ? 0
        : Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, current + (action === 'in' ? 1 : -1)));

    if (next !== current) {
      webContents.setZoomLevel(next);
      logger.debug(`Zoom ${action}: level ${current} -> ${next}`);
    }

    this.broadcast(webContents, next);
  }

  private broadcast(webContents: WebContents, level: number): void {
    const factor = Number((1.2 ** level).toFixed(4));
    try {
      webContents.send('zoom:changed', { factor, level });
    } catch (error) {
      logger.warn('Failed to broadcast zoom:changed', error);
    }
  }
}
