import { join } from 'node:path';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { type BrowserWindow, type BrowserWindowConstructorOptions, nativeTheme } from 'electron';

import { buildDir } from '@/const/dir';
import { isDev, isLinux, isMac, isWindows } from '@/const/env';
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

interface LinuxThemeConfig {
  backgroundColor: string;
  hasShadow: true;
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
  getPlatformConfig(): Partial<BrowserWindowConstructorOptions> {
    if (isWindows) {
      return this.getWindowsConfig(this.isDarkMode);
    }
    if (isMac) {
      // Calculate traffic light position to center vertically in title bar
      // Traffic light buttons are approximately 12px tall
      const trafficLightY = Math.round((TITLE_BAR_HEIGHT - 12) / 2);

      return {
        trafficLightPosition: { x: 12, y: trafficLightY },
        vibrancy: 'sidebar',
        visualEffectState: 'active',
      };
    }
    if (isLinux) {
      return this.getLinuxConfig();
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

  private getLinuxConfig(): LinuxThemeConfig {
    return {
      backgroundColor: this.resolveIsDarkMode() ? BACKGROUND_DARK : BACKGROUND_LIGHT,
      hasShadow: true,
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
      } else if (isLinux) {
        this.applyLinuxVisualEffects();
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

  private applyLinuxVisualEffects(): void {
    if (!this.browserWindow) return;

    const config = this.getLinuxConfig();
    const browserWindow = this.browserWindow as BrowserWindow & {
      setHasShadow?: (hasShadow: boolean) => void;
    };

    browserWindow.setBackgroundColor(config.backgroundColor);
    browserWindow.setHasShadow?.(true);
  }
}
