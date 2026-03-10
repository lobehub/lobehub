import { join } from 'node:path';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { type BrowserWindow, type BrowserWindowConstructorOptions, nativeTheme } from 'electron';

import { buildDir } from '@/const/dir';
import { isDev, isMac, isMacTahoe, isWindows } from '@/const/env';
import { createLogger } from '@/utils/logger';

import {
  BACKGROUND_DARK,
  BACKGROUND_LIGHT,
  SYMBOL_COLOR_DARK,
  SYMBOL_COLOR_LIGHT,
  THEME_CHANGE_DELAY,
} from '../../const/theme';

const logger = createLogger('core:WindowThemeManager');

interface WindowsThemeConfig {
  backgroundColor: string;
  icon?: string;
  titleBarOverlay: {
    color: string;
    height: number;
    symbolColor: string;
  };
  titleBarStyle: 'hidden';
}

// Lazy-load liquid glass only on macOS Tahoe to avoid import errors on other platforms.
// Dynamic require is intentional: native .node addons cannot be loaded via
// async import() and must be synchronously required at module init time.
let liquidGlass: typeof import('electron-liquid-glass').default | undefined;
if (isMacTahoe) {
  try {
    liquidGlass = require('electron-liquid-glass');
  } catch {
    // Native module not available (e.g. wrong architecture or missing binary)
  }
}

/**
 * Manages window theme configuration and visual effects
 */
export class WindowThemeManager {
  private readonly identifier: string;
  private browserWindow?: BrowserWindow;
  private listenerSetup = false;
  private boundHandleThemeChange: () => void;
  private liquidGlassViewId?: number;

  constructor(identifier: string) {
    this.identifier = identifier;
    this.boundHandleThemeChange = this.handleThemeChange.bind(this);
  }

  private getWindowsTitleBarOverlay(isDarkMode: boolean): WindowsThemeConfig['titleBarOverlay'] {
    return {
      color: '#00000000',
      // Reduce 2px to prevent blocking the container border edge
      height: TITLE_BAR_HEIGHT - 2,
      symbolColor: isDarkMode ? SYMBOL_COLOR_DARK : SYMBOL_COLOR_LIGHT,
    };
  }

  // ==================== Lifecycle ====================

  /**
   * Attach to a browser window and setup theme handling.
   * Owns the full visual effect lifecycle including liquid glass on macOS Tahoe.
   */
  attach(browserWindow: BrowserWindow): void {
    this.browserWindow = browserWindow;
    this.setupThemeListener();
    this.applyVisualEffects();

    // Liquid glass must be applied after window content loads (native view needs
    // a rendered surface). The effect persists across subsequent in-window navigations.
    if (this.useLiquidGlass) {
      browserWindow.webContents.once('did-finish-load', () => {
        this.applyLiquidGlass();
      });
    }
  }

  /**
   * Cleanup theme listener when window is destroyed
   */
  cleanup(): void {
    if (this.listenerSetup) {
      nativeTheme.off('updated', this.boundHandleThemeChange);
      this.listenerSetup = false;
      logger.debug(`[${this.identifier}] Theme listener cleaned up.`);
    }
    this.liquidGlassViewId = undefined;
    this.browserWindow = undefined;
  }

  // ==================== Theme Configuration ====================

  /**
   * Get current dark mode state
   */
  get isDarkMode(): boolean {
    return nativeTheme.shouldUseDarkColors;
  }

  /**
   * Whether liquid glass is available and should be used
   */
  get useLiquidGlass(): boolean {
    return isMacTahoe && !!liquidGlass;
  }

  /**
   * Get platform-specific theme configuration for window creation
   */
  getPlatformConfig(): Partial<BrowserWindowConstructorOptions> {
    if (isWindows) {
      return this.getWindowsConfig(this.isDarkMode);
    }
    if (isMac) {
      // Calculate traffic light position to center vertically in title bar
      // Traffic light buttons are approximately 12px tall
      const trafficLightY = Math.round((TITLE_BAR_HEIGHT - 12) / 2);

      if (this.useLiquidGlass) {
        // Liquid glass requires transparent window and must NOT use vibrancy — they conflict.
        return {
          trafficLightPosition: { x: 12, y: trafficLightY },
          transparent: true,
        };
      }

      return {
        trafficLightPosition: { x: 12, y: trafficLightY },
        vibrancy: 'sidebar',
        visualEffectState: 'active',
      };
    }
    return {};
  }

  /**
   * Get Windows-specific theme configuration
   */
  private getWindowsConfig(isDarkMode: boolean): WindowsThemeConfig {
    return {
      backgroundColor: isDarkMode ? BACKGROUND_DARK : BACKGROUND_LIGHT,
      icon: isDev ? join(buildDir, 'icon-dev.ico') : undefined,
      titleBarOverlay: this.getWindowsTitleBarOverlay(isDarkMode),
      titleBarStyle: 'hidden',
    };
  }

  // ==================== Theme Listener ====================

  private setupThemeListener(): void {
    if (this.listenerSetup) return;

    nativeTheme.on('updated', this.boundHandleThemeChange);
    this.listenerSetup = true;
    logger.debug(`[${this.identifier}] Theme listener setup.`);
  }

  private handleThemeChange(): void {
    logger.debug(`[${this.identifier}] System theme changed, reapplying visual effects.`);
    setTimeout(() => {
      this.applyVisualEffects();
    }, THEME_CHANGE_DELAY);
  }

  /**
   * Handle application theme mode change (called from BrowserManager)
   */
  handleAppThemeChange(): void {
    logger.debug(`[${this.identifier}] App theme mode changed, reapplying visual effects.`);
    setTimeout(() => {
      this.applyVisualEffects();
    }, THEME_CHANGE_DELAY);
  }

  // ==================== Visual Effects ====================

  /**
   * Resolve dark mode from Electron theme source for runtime visual effect updates.
   * Checks explicit themeSource first to handle app-level theme overrides correctly.
   */
  private resolveIsDarkMode(): boolean {
    if (nativeTheme.themeSource === 'dark') return true;
    if (nativeTheme.themeSource === 'light') return false;
    return nativeTheme.shouldUseDarkColors;
  }

  /**
   * Apply visual effects based on current theme.
   * Single entry point for ALL platform visual effects.
   */
  applyVisualEffects(): void {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;

    const isDarkMode = this.resolveIsDarkMode();
    logger.debug(`[${this.identifier}] Applying visual effects (dark: ${isDarkMode})`);

    try {
      if (isWindows) {
        this.applyWindowsVisualEffects(isDarkMode);
      } else if (isMac) {
        this.applyMacVisualEffects();
      }
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to apply visual effects:`, error);
    }
  }

  /**
   * Manually reapply visual effects
   */
  reapplyVisualEffects(): void {
    logger.debug(`[${this.identifier}] Manually reapplying visual effects.`);
    this.applyVisualEffects();
  }

  private applyWindowsVisualEffects(isDarkMode: boolean): void {
    if (!this.browserWindow) return;

    const config = this.getWindowsConfig(isDarkMode);
    this.browserWindow.setBackgroundColor(config.backgroundColor);
    this.browserWindow.setTitleBarOverlay(config.titleBarOverlay);
  }

  /**
   * Apply macOS visual effects.
   * - Tahoe+: liquid glass auto-adapts to dark mode; ensure it's applied if not yet.
   * - Pre-Tahoe: vibrancy is managed natively by Electron, no runtime action needed.
   */
  private applyMacVisualEffects(): void {
    if (!this.browserWindow) return;

    if (this.useLiquidGlass) {
      // Attempt apply if not yet done (e.g. initial load failed, or window recreated)
      this.applyLiquidGlass();
    }
  }

  // ==================== Liquid Glass ====================

  /**
   * Apply liquid glass native view to the window.
   * Idempotent — guards against double-application via `liquidGlassViewId`.
   */
  applyLiquidGlass(): void {
    if (!this.useLiquidGlass || !liquidGlass) return;
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    if (this.liquidGlassViewId !== undefined) return;

    try {
      // Ensure traffic light buttons remain visible with transparent window
      this.browserWindow.setWindowButtonVisibility(true);

      const handle = this.browserWindow.getNativeWindowHandle();

      this.liquidGlassViewId = liquidGlass.addView(handle);
      liquidGlass.unstable_setVariant(this.liquidGlassViewId, 15);

      logger.info(`[${this.identifier}] Liquid glass applied (viewId: ${this.liquidGlassViewId})`);
    } catch (error) {
      logger.error(`[${this.identifier}] Failed to apply liquid glass:`, error);
    }
  }
}
