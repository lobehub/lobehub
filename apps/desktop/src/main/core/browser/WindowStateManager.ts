import Electron, { BrowserWindow, screen } from 'electron';

import { createLogger } from '@/utils/logger';

import type { App } from '../App';

const logger = createLogger('core:WindowStateManager');

export interface WindowState {
  height?: number;
  width?: number;
  x?: number;
  y?: number;
}

export interface WindowStateManagerOptions {
  identifier: string;
  keepAlive?: boolean;
}

/**
 * Manages window state persistence and close behavior
 */
export class WindowStateManager {
  private readonly app: App;
  private readonly identifier: string;
  private readonly stateKey: string;
  private readonly keepAlive: boolean;

  constructor(app: App, options: WindowStateManagerOptions) {
    this.app = app;
    this.identifier = options.identifier;
    this.stateKey = `windowSize_${options.identifier}`;
    this.keepAlive = options.keepAlive ?? false;
  }

  // ==================== State Persistence ====================

  /**
   * Load saved window state from persistent storage
   */
  loadState(): WindowState | undefined {
    return this.app.storeManager.get(this.stateKey as any) as WindowState | undefined;
  }

  /**
   * Save current window bounds to persistent storage
   */
  saveState(browserWindow: BrowserWindow, context: 'quit' | 'close' | 'hide' = 'close'): void {
    try {
      const bounds = browserWindow.getBounds();
      const state: WindowState = {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      };
      logger.debug(
        `[${this.identifier}] Saving window state on ${context}: ${JSON.stringify(state)}`,
      );
      this.app.storeManager.set(this.stateKey as any, state);
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to save window state on ${context}:`, error);
    }
  }

  // ==================== State Resolution ====================

  /**
   * Resolve window state by merging saved state with fallback,
   * ensuring position is within visible screen bounds
   */
  resolveState(fallback: { height?: number; width?: number }): WindowState {
    const savedState = this.loadState();
    return this.resolveWindowState(savedState, fallback);
  }

  private resolveWindowState(
    savedState: WindowState | undefined,
    fallbackState: { height?: number; width?: number },
  ): WindowState {
    const width = savedState?.width ?? fallbackState.width;
    const height = savedState?.height ?? fallbackState.height;
    const resolvedState: WindowState = { height, width };

    const hasPosition = Number.isFinite(savedState?.x) && Number.isFinite(savedState?.y);
    if (!hasPosition) return resolvedState;

    const x = savedState?.x as number;
    const y = savedState?.y as number;

    const targetDisplay = screen.getDisplayMatching({
      height: height ?? 0,
      width: width ?? 0,
      x,
      y,
    });

    const workArea = targetDisplay?.workArea ?? screen.getPrimaryDisplay().workArea;
    const resolvedWidth = typeof width === 'number' ? Math.min(width, workArea.width) : width;
    const resolvedHeight = typeof height === 'number' ? Math.min(height, workArea.height) : height;

    const maxX = workArea.x + Math.max(0, workArea.width - (resolvedWidth ?? 0));
    const maxY = workArea.y + Math.max(0, workArea.height - (resolvedHeight ?? 0));

    return {
      height: resolvedHeight,
      width: resolvedWidth,
      x: this.clampNumber(x, workArea.x, maxX),
      y: this.clampNumber(y, workArea.y, maxY),
    };
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  // ==================== Close Event Handling ====================

  /**
   * Create a close event handler for the browser window
   * Returns a handler function and a cleanup function
   */
  createCloseHandler(
    browserWindow: BrowserWindow,
    callbacks: {
      onCleanup: () => void;
      onHide: () => void;
    },
  ): (e: Electron.Event) => void {
    return (e: Electron.Event) => {
      logger.debug(`Window 'close' event triggered for: ${this.identifier}`);
      logger.debug(
        `[${this.identifier}] State during close event: isQuiting=${this.app.isQuiting}, keepAlive=${this.keepAlive}`,
      );

      if (this.app.isQuiting) {
        this.handleCloseOnQuit(browserWindow, callbacks.onCleanup);
        return;
      }

      if (this.keepAlive) {
        this.handleCloseWithKeepAlive(e, callbacks.onHide);
      } else {
        this.handleCloseNormally(browserWindow, callbacks.onCleanup);
      }
    };
  }

  /**
   * Handle close when application is quitting - save state and cleanup
   */
  private handleCloseOnQuit(browserWindow: BrowserWindow, onCleanup: () => void): void {
    logger.debug(`[${this.identifier}] App is quitting, allowing window to close naturally.`);
    this.saveState(browserWindow, 'quit');
    onCleanup();
  }

  /**
   * Handle close when keepAlive is enabled - prevent close and hide instead
   */
  private handleCloseWithKeepAlive(e: Electron.Event, onHide: () => void): void {
    logger.debug(
      `[${this.identifier}] keepAlive is true, preventing default close and hiding window.`,
    );
    e.preventDefault();
    onHide();
  }

  /**
   * Handle normal close - save state, cleanup, and allow window to close
   */
  private handleCloseNormally(browserWindow: BrowserWindow, onCleanup: () => void): void {
    logger.debug(
      `[${this.identifier}] keepAlive is false, allowing window to close. Saving state...`,
    );
    this.saveState(browserWindow, 'close');
    onCleanup();
  }
}
