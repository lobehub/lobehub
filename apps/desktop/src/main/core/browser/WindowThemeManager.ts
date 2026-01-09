import { BrowserWindow, nativeTheme } from 'electron';
import { join } from 'node:path';

import { buildDir } from '@/const/dir';
import { isDev, isWindows } from '@/const/env';
import {
  BACKGROUND_DARK,
  BACKGROUND_LIGHT,
  SYMBOL_COLOR_DARK,
  SYMBOL_COLOR_LIGHT,
  THEME_CHANGE_DELAY,
  TITLE_BAR_HEIGHT,
} from '@/const/theme';
import { createLogger } from '@/utils/logger';

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

/**
 * Manages window theme configuration and visual effects
 */
export class WindowThemeManager {
  private readonly identifier: string;
  private browserWindow?: BrowserWindow;
  private listenerSetup = false;
  private boundHandleThemeChange: () => void;

  constructor(identifier: string) {
    this.identifier = identifier;
    this.boundHandleThemeChange = this.handleThemeChange.bind(this);
  }

  // ==================== Lifecycle ====================

  /**
   * Attach to a browser window and setup theme handling
   */
  attach(browserWindow: BrowserWindow): void {
    this.browserWindow = browserWindow;
    this.setupThemeListener();
    this.applyVisualEffects();
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
   * Get platform-specific theme configuration for window creation
   */
  getPlatformConfig(): Partial<WindowsThemeConfig> {
    if (isWindows) {
      return this.getWindowsConfig(this.isDarkMode);
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
      titleBarOverlay: {
        color: isDarkMode ? BACKGROUND_DARK : BACKGROUND_LIGHT,
        height: TITLE_BAR_HEIGHT,
        symbolColor: isDarkMode ? SYMBOL_COLOR_DARK : SYMBOL_COLOR_LIGHT,
      },
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
   * Apply visual effects based on current theme
   */
  applyVisualEffects(): void {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;

    logger.debug(`[${this.identifier}] Applying visual effects for platform`);
    const isDarkMode = this.isDarkMode;

    try {
      if (isWindows) {
        this.applyWindowsVisualEffects(isDarkMode);
      }

      logger.debug(
        `[${this.identifier}] Visual effects applied successfully (dark mode: ${isDarkMode})`,
      );
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
}
