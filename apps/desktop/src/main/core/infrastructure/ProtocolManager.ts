import { app } from 'electron';

import { isDev } from '@/const/env';
import { createPathTarget, type LaunchTarget, parseLaunchArgs } from '@/utils/launchTarget';
import { createLogger } from '@/utils/logger';
import { getProtocolScheme, parseProtocolUrl } from '@/utils/protocol';

import type { App } from '../App';

// Create logger
const logger = createLogger('core:ProtocolManager');

/**
 * Protocol handler manager for custom URI schemes
 */
export class ProtocolManager {
  private app: App;
  private protocolScheme: string;
  private pendingTargets: LaunchTarget[] = [];

  constructor(app: App) {
    logger.debug('Initializing ProtocolManager');
    this.app = app;
    this.protocolScheme = getProtocolScheme();
    logger.info(`ProtocolManager initialized for scheme: ${this.protocolScheme}://`);
  }

  /**
   * Schemes this build answers to. `parseProtocolUrl` validates the real set; a
   * target only has to be recognised here so a foreign URL is dispatched (and
   * rejected with a log) instead of being mistaken for a directory.
   */
  private get acceptedSchemes(): string[] {
    return ['lobehub', 'lobehub-beta', 'lobehub-dev', 'lobehub-nightly', this.protocolScheme];
  }

  /**
   * Register protocol handlers and set up event listeners
   */
  public initialize(): void {
    logger.debug('Setting up protocol handlers');

    this.registerProtocolHandlers();
    this.setupEventListeners();

    logger.debug('Protocol initialization completed');
  }

  /**
   * Register the application as default protocol client
   */
  private registerProtocolHandlers(): void {
    logger.debug(`🔗 [Protocol] Registering protocol handlers for ${this.protocolScheme}://`);

    // Debug info about current app
    logger.debug(`🔗 [Protocol] App name: ${app.name}`);
    logger.debug(`🔗 [Protocol] App path: ${app.getPath('exe')}`);
    logger.debug(`🔗 [Protocol] Is development: ${isDev}`);
    logger.debug(`🔗 [Protocol] Process argv[0]: ${process.argv[0]}`);

    // Check if already registered
    const isCurrentlyRegistered = app.isDefaultProtocolClient(this.protocolScheme);
    logger.debug(
      `🔗 [Protocol] ${this.protocolScheme}:// is currently registered: ${isCurrentlyRegistered}`,
    );

    // Register as default protocol client
    let registrationResult: boolean;

    if (isDev) {
      // In development, use explicit parameters to ensure proper registration
      const appPath = process.cwd(); // Current working directory (our app)
      logger.debug(`🔗 [Protocol] Development mode: using explicit registration parameters`);
      logger.debug(`🔗 [Protocol] Executable path: ${process.execPath}`);
      logger.debug(`🔗 [Protocol] App path: ${appPath}`);
      logger.debug(`🔗 [Protocol] Arguments: ${JSON.stringify([appPath])}`);

      registrationResult = app.setAsDefaultProtocolClient(this.protocolScheme, process.execPath, [
        appPath,
      ]);
    } else {
      // In production, use simple registration
      registrationResult = app.setAsDefaultProtocolClient(this.protocolScheme);
    }

    logger.debug(
      `🔗 [Protocol] Registration result for ${this.protocolScheme}://: ${registrationResult}`,
    );

    if (!registrationResult) {
      logger.error(
        `🔗 [Protocol] Failed to register as default protocol client for ${this.protocolScheme}://`,
      );
    } else {
      logger.debug(`🔗 [Protocol] Successfully registered ${this.protocolScheme}:// protocol`);
    }

    // Verify registration
    const isRegisteredAfter = app.isDefaultProtocolClient(this.protocolScheme);
    logger.debug(
      `🔗 [Protocol] Final registration status for ${this.protocolScheme}://: ${isRegisteredAfter}`,
    );
  }

  /**
   * Set up protocol event listeners
   */
  private setupEventListeners(): void {
    // Cold start: the launching shell's arguments (deep link, or a directory).
    const coldStartTarget = this.parseLaunchTarget(process.argv);
    if (coldStartTarget) {
      logger.debug(`🔗 [Launch] Found target from cold start:`, coldStartTarget);
      this.pendingTargets.push(coldStartTarget);
    }

    // macOS delivers links through open-url, never through argv.
    app.on('open-url', (event, url) => {
      event.preventDefault();
      logger.debug(`🔗 [Protocol] Received URL from open-url event: ${url}`);
      this.handleLaunchTarget({ kind: 'url', url });
    });

    /**
     * macOS also delivers Finder drops, `open -a LobeHub .` and "Open With"
     * here. Nothing listened to this event before, so every one of those
     * gestures was silently dropped — no log, no window, no hint.
     */
    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      // `open-file` fires before `ready` on a cold launch; the queue covers it.
      const target = createPathTarget(filePath);
      if (!target) {
        logger.debug(`🔗 [Launch] open-file path is not a directory, ignoring: ${filePath}`);
        return;
      }
      logger.debug(`🔗 [Launch] Received directory from open-file: ${filePath}`);
      this.handleLaunchTarget(target);
    });

    // Windows/Linux re-launch the binary for every new invocation.
    app.on('second-instance', (event, commandLine) => {
      const target = this.parseLaunchTarget(commandLine);
      if (target) {
        logger.debug(`🔗 [Launch] Received target from second instance:`, target);
        this.handleLaunchTarget(target);
      }
      // Show main window when second instance is triggered
      this.app.browserManager.showMainWindow();
    });
  }

  /**
   * Read the launch target out of a command line. A directory in argv used to
   * be invisible here — only `scheme://` URLs were scanned — so `LobeHub .`
   * started a window that knew nothing about the argument.
   */
  private parseLaunchTarget(argv: readonly string[]): LaunchTarget | null {
    return parseLaunchArgs(argv, {
      // Development launches carry the source tree as argv[1]; a release never does.
      appPaths: isDev ? [process.cwd()] : [],
      schemes: this.acceptedSchemes,
    });
  }

  /**
   * Handle a launch target - either immediately or store for later processing.
   *
   * Both a deep link and a directory take this path, so the "app is not ready"
   * and "startup update is replacing the window" cases only have to be solved
   * once.
   */
  private handleLaunchTarget(target: LaunchTarget): void {
    try {
      logger.debug(`🔗 [Launch] Handling target:`, target);
      logger.debug(`🔗 [Launch] App ready state: ${app.isReady()}`);

      if (!app.isReady() || this.app.startupUpdatePending) {
        logger.debug('🔗 [Launch] App not ready, queueing target for later processing');
        this.pendingTargets.push(target);
        return;
      }

      void this.dispatchLaunchTarget(target);
    } catch (error) {
      logger.error('🔗 [Launch] Failed to handle launch target:', error);
    }
  }

  private async dispatchLaunchTarget(target: LaunchTarget): Promise<void> {
    // A launch is a user asking to see the app, whatever it carries.
    this.app.browserManager.showMainWindow();

    if (target.kind === 'path') {
      try {
        const handled = await this.app.handleProtocolRequest('open', 'path', {
          newWindow: target.newWindow,
          path: target.path,
        });
        if (!handled) {
          logger.warn(`🔗 [Launch] Directory was not opened (no handler result): ${target.path}`);
        }
      } catch (error) {
        logger.error('🔗 [Launch] Failed to open directory:', error);
      }
      return;
    }

    await this.processProtocolUrl(target.url);
  }

  /**
   * Process protocol URL by showing main window and sending to renderer
   */
  private async processProtocolUrl(url: string): Promise<void> {
    try {
      logger.debug(`🔗 [Protocol] processProtocolUrl called with: ${url}`);

      // Parse protocol URL to extract urlType and action (validates the scheme too)
      const parsed = parseProtocolUrl(url);

      if (!parsed) {
        logger.warn(`🔗 [Protocol] Failed to parse protocol URL: ${url}`);
        return;
      }

      logger.debug(
        `🔗 [Protocol] Parsed URL - type: ${parsed.urlType}, action: ${parsed.action}, data: %s`,
        parsed.params,
      );

      // Dispatch to registered protocol handlers via App with parsed data
      logger.debug('🔗 [Protocol] Dispatching to protocol handlers...');
      const handled = await this.app.handleProtocolRequest(
        parsed.urlType,
        parsed.action,
        parsed.params,
      );

      if (handled) {
        logger.debug('🔗 [Protocol] Protocol URL processed successfully by handler');
      } else {
        logger.warn(
          `🔗 [Protocol] No handler found for protocol: ${parsed.urlType}:${parsed.action}`,
        );
      }
    } catch (error) {
      logger.error('🔗 [Protocol] Failed to process protocol URL:', error);
      logger.error('🔗 [Protocol] Error details:', error);
    }
  }

  /**
   * Process any targets that arrived before the app was ready
   */
  public async processPendingTargets(): Promise<void> {
    logger.debug(`🔗 [Launch] processPendingTargets called`);
    logger.debug(`🔗 [Launch] Pending targets count: ${this.pendingTargets.length}`);

    if (this.pendingTargets.length === 0) {
      logger.debug(`🔗 [Launch] No pending targets to process`);
      return;
    }

    const targets = this.pendingTargets;
    // Clear before awaiting: a target that arrives while this loop runs must
    // dispatch itself, not wait for a queue drain that already read it.
    this.pendingTargets = [];

    for (const target of targets) {
      logger.debug(`🔗 [Launch] Processing pending target:`, target);
      await this.dispatchLaunchTarget(target);
    }
  }

  /**
   * Get current protocol scheme
   */
  public getScheme(): string {
    return this.protocolScheme;
  }

  /**
   * Check if protocol is registered
   */
  public isRegistered(): boolean {
    return app.isDefaultProtocolClient(this.protocolScheme);
  }
}
