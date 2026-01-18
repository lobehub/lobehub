import { globalShortcut } from 'electron';

import { DEFAULT_SHORTCUTS_CONFIG } from '@/shortcuts';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';

// Create logger
const logger = createLogger('core:ShortcutManager');

export interface ShortcutUpdateResult {
  errorType?:
    | 'INVALID_ID'
    | 'INVALID_FORMAT'
    | 'NO_MODIFIER'
    | 'CONFLICT'
    | 'SYSTEM_OCCUPIED'
    | 'UNKNOWN';
  success: boolean;
}

export class ShortcutManager {
  private app: App;
  private shortcuts: Map<string, () => void> = new Map();
  private shortcutsConfig: Record<string, string> = {};

  constructor(app: App) {
    logger.debug('Initializing ShortcutManager');
    this.app = app;

    app.shortcutMethodMap.forEach((method, key) => {
      this.shortcuts.set(key, method);
    });
  }

  /**
   * Convert react-hotkey format to Electron accelerator format
   * @param accelerator The accelerator string from frontend
   * @returns Converted accelerator string for Electron
   */
  private convertAcceleratorFormat(accelerator: string): string {
    return accelerator
      .split('+')
      .map((key) => {
        const trimmedKey = key.trim().toLowerCase();

        // Convert react-hotkey 'mod' to Electron 'CommandOrControl'
        if (trimmedKey === 'mod') {
          return 'CommandOrControl';
        }

        // Keep other keys as is, but preserve proper casing
        return key.trim().length === 1 ? key.trim().toUpperCase() : key.trim();
      })
      .join('+');
  }

  initialize() {
    logger.info('Initializing global shortcuts');
    // Load shortcuts configuration from storage
    this.loadShortcutsConfig();
    // Register configured shortcuts
    this.registerConfiguredShortcuts();
  }

  /**
   * Get shortcuts configuration
   */
  getShortcutsConfig(): Record<string, string> {
    return this.shortcutsConfig;
  }

  /**
   * Update a single shortcut configuration
   */
  updateShortcutConfig(id: string, accelerator: string): ShortcutUpdateResult {
    try {
      logger.debug(`Updating shortcut ${id} to ${accelerator}`);

      // 1. Check if ID is valid
      if (!DEFAULT_SHORTCUTS_CONFIG[id]) {
        logger.error(`Invalid shortcut ID: ${id}`);
        return { errorType: 'INVALID_ID', success: false };
      }

      // 2. Basic format validation
      if (!accelerator || typeof accelerator !== 'string' || accelerator.trim() === '') {
        logger.error(`Invalid accelerator format: ${accelerator}`);
        return { errorType: 'INVALID_FORMAT', success: false };
      }

      // Convert frontend format to Electron format
      const convertedAccelerator = this.convertAcceleratorFormat(accelerator.trim());
      const cleanAccelerator = convertedAccelerator.toLowerCase();

      logger.debug(`Converted accelerator from ${accelerator} to ${convertedAccelerator}`);

      // 3. Check if contains + sign (modifier key format)
      if (!cleanAccelerator.includes('+')) {
        logger.error(
          `Invalid accelerator format: ${cleanAccelerator}. Must contain modifier keys like 'CommandOrControl+E'`,
        );
        return { errorType: 'INVALID_FORMAT', success: false };
      }

      // 4. Check if has basic modifier keys
      const hasModifier = ['CommandOrControl', 'Command', 'Ctrl', 'Alt', 'Shift'].some((modifier) =>
        cleanAccelerator.includes(modifier.toLowerCase()),
      );

      if (!hasModifier) {
        logger.error(`Invalid accelerator format: ${cleanAccelerator}. Must contain modifier keys`);
        return { errorType: 'NO_MODIFIER', success: false };
      }

      // 5. Check for conflicts
      for (const [existingId, existingAccelerator] of Object.entries(this.shortcutsConfig)) {
        if (
          existingId !== id &&
          typeof existingAccelerator === 'string' &&
          existingAccelerator.toLowerCase() === cleanAccelerator
        ) {
          logger.error(`Shortcut conflict: ${cleanAccelerator} already used by ${existingId}`);
          return { errorType: 'CONFLICT', success: false };
        }
      }

      // 6. Try test registration (check if occupied by system)
      const testSuccess = globalShortcut.register(convertedAccelerator, () => {});
      if (!testSuccess) {
        logger.error(
          `Shortcut ${convertedAccelerator} is already registered by system or other app`,
        );
        return { errorType: 'SYSTEM_OCCUPIED', success: false };
      } else {
        // Test successful, immediately unregister
        globalShortcut.unregister(convertedAccelerator);
      }

      // 7. Update configuration
      this.shortcutsConfig[id] = convertedAccelerator;

      this.saveShortcutsConfig();
      this.registerConfiguredShortcuts();
      return { success: true };
    } catch (error) {
      logger.error(`Error updating shortcut ${id}:`, error);
      return { errorType: 'UNKNOWN', success: false };
    }
  }

  /**
   * Register global shortcut
   * @param accelerator Shortcut key combination
   * @param callback Callback function
   * @returns Whether registration was successful
   */
  registerShortcut(accelerator: string, callback: () => void): boolean {
    try {
      // If already registered, unregister first
      if (this.shortcuts.has(accelerator)) {
        this.unregisterShortcut(accelerator);
      }

      // Register new shortcut
      const success = globalShortcut.register(accelerator, callback);

      if (success) {
        this.shortcuts.set(accelerator, callback);
        logger.debug(`Registered shortcut: ${accelerator}`);
      } else {
        logger.error(`Failed to register shortcut: ${accelerator}`);
      }

      return success;
    } catch (error) {
      logger.error(`Error registering shortcut: ${accelerator}`, error);
      return false;
    }
  }

  /**
   * Unregister global shortcut
   * @param accelerator Shortcut key combination
   */
  unregisterShortcut(accelerator: string): void {
    try {
      globalShortcut.unregister(accelerator);
      this.shortcuts.delete(accelerator);
      logger.debug(`Unregistered shortcut: ${accelerator}`);
    } catch (error) {
      logger.error(`Error unregistering shortcut: ${accelerator}`, error);
    }
  }

  /**
   * Check if a shortcut is already registered
   * @param accelerator Shortcut key combination
   * @returns Whether it is registered
   */
  isRegistered(accelerator: string): boolean {
    return globalShortcut.isRegistered(accelerator);
  }

  /**
   * Unregister all shortcuts
   */
  unregisterAll(): void {
    globalShortcut.unregisterAll();
    logger.info('Unregistered all shortcuts');
  }

  /**
   * Load shortcuts configuration from storage
   */
  private loadShortcutsConfig() {
    try {
      // Try to get configuration from storage
      const config = this.app.storeManager.get('shortcuts');

      // If no configuration, use default configuration
      if (!config || Object.keys(config).length === 0) {
        logger.debug('No shortcuts config found, using defaults');
        this.shortcutsConfig = DEFAULT_SHORTCUTS_CONFIG;
        this.saveShortcutsConfig();
      } else {
        // Filter out invalid shortcuts that are not in DEFAULT_SHORTCUTS_CONFIG
        const filteredConfig: Record<string, string> = {};
        let hasInvalidKeys = false;

        Object.entries(config).forEach(([id, accelerator]) => {
          if (DEFAULT_SHORTCUTS_CONFIG[id]) {
            filteredConfig[id] = accelerator;
          } else {
            hasInvalidKeys = true;
            logger.debug(`Filtering out invalid shortcut ID: ${id}`);
          }
        });

        // Ensure all default shortcuts are present
        Object.entries(DEFAULT_SHORTCUTS_CONFIG).forEach(([id, defaultAccelerator]) => {
          if (!(id in filteredConfig)) {
            filteredConfig[id] = defaultAccelerator;
            logger.debug(`Adding missing default shortcut: ${id} = ${defaultAccelerator}`);
          }
        });

        this.shortcutsConfig = filteredConfig;

        // Save the filtered configuration back to storage if we removed invalid keys
        if (hasInvalidKeys) {
          logger.debug('Saving filtered shortcuts config to remove invalid keys');
          this.saveShortcutsConfig();
        }
      }

      logger.debug('Loaded shortcuts config:', this.shortcutsConfig);
    } catch (error) {
      logger.error('Error loading shortcuts config:', error);
      this.shortcutsConfig = DEFAULT_SHORTCUTS_CONFIG;
      this.saveShortcutsConfig();
    }
  }

  /**
   * Save shortcuts configuration to storage
   */
  private saveShortcutsConfig() {
    try {
      this.app.storeManager.set('shortcuts', this.shortcutsConfig);
      logger.debug('Saved shortcuts config');
    } catch (error) {
      logger.error('Error saving shortcuts config:', error);
    }
  }

  /**
   * Register configured shortcuts
   */
  private registerConfiguredShortcuts() {
    // Unregister all shortcuts first
    this.unregisterAll();

    // Register each enabled shortcut
    Object.entries(this.shortcutsConfig).forEach(([id, accelerator]) => {
      logger.debug(`Registering shortcut '${id}' with ${accelerator}`);

      // Only register shortcuts that exist in DEFAULT_SHORTCUTS_CONFIG
      if (!DEFAULT_SHORTCUTS_CONFIG[id]) {
        logger.debug(`Skipping shortcut '${id}' - not found in DEFAULT_SHORTCUTS_CONFIG`);
        return;
      }

      const method = this.shortcuts.get(id);
      if (accelerator && method) {
        this.registerShortcut(accelerator, method);
      }
    });
  }
}
