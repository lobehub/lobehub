import { DataSyncConfig } from '@lobechat/electron-client-ipc';
import retry from 'async-retry';
import { session as electronSession, safeStorage } from 'electron';
import querystring from 'node:querystring';
import { URL } from 'node:url';

import { OFFICIAL_CLOUD_SERVER } from '@/const/env';
import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

/**
 * Non-retryable OIDC error codes
 * These errors indicate the refresh token is invalid and retry won't help
 */
const NON_RETRYABLE_OIDC_ERRORS = [
  'invalid_grant', // refresh token is invalid, expired, or revoked
  'invalid_client', // client configuration error
  'unauthorized_client', // client not authorized
  'access_denied', // user denied access
  'invalid_scope', // requested scope is invalid
];

/**
 * Deterministic failures that will never succeed on retry
 * These are permanent state issues that require user intervention
 */
const DETERMINISTIC_FAILURES = [
  'no refresh token available', // refresh token is missing from storage
  'remote server is not active or configured', // config is invalid or disabled
  'missing tokens in refresh response', // server returned incomplete response
];

// Create logger
const logger = createLogger('controllers:RemoteServerConfigCtr');

/**
 * Remote Server Configuration Controller
 * Used to manage custom remote LobeChat server configuration
 */
export default class RemoteServerConfigCtr extends ControllerModule {
  static override readonly groupName = 'remoteServer';
  /**
   * Key used to store encrypted tokens in electron-store.
   */
  private readonly encryptedTokensKey = 'encryptedTokens';

  /**
   * Normalize legacy config that used local storageMode.
   * Local mode has been removed; fall back to cloud.
   */
  private normalizeConfig = (config: DataSyncConfig): DataSyncConfig => {
    // Use type assertion to handle legacy 'local' value from stored data
    if ((config.storageMode as string) !== 'local') return config;

    const nextConfig: DataSyncConfig = {
      ...config,
      remoteServerUrl: config.remoteServerUrl || OFFICIAL_CLOUD_SERVER,
      storageMode: 'cloud',
    };

    this.app.storeManager.set('dataSyncConfig', nextConfig);

    return nextConfig;
  };

  /**
   * Get remote server configuration
   */
  @IpcMethod()
  async getRemoteServerConfig() {
    logger.debug('Getting remote server configuration');
    const { storeManager } = this.app;

    const config: DataSyncConfig = storeManager.get('dataSyncConfig');
    const normalized = this.normalizeConfig(config);

    logger.debug(
      `Remote server config: active=${normalized.active}, storageMode=${normalized.storageMode}, url=${normalized.remoteServerUrl}`,
    );

    return normalized;
  }

  /**
   * Check if remote server is properly configured and ready for use
   * For 'cloud' mode, only checks if active (remoteServerUrl is undefined, uses OFFICIAL_CLOUD_SERVER)
   * For 'selfHost' mode, checks if active AND remoteServerUrl is configured
   * @param config Optional config object, if not provided will fetch current config
   * @returns true if remote server is properly configured
   */
  async isRemoteServerConfigured(config?: DataSyncConfig): Promise<boolean> {
    const effectiveConfig = config ?? (await this.getRemoteServerConfig());
    return (
      effectiveConfig.active &&
      (effectiveConfig.storageMode !== 'selfHost' || !!effectiveConfig.remoteServerUrl)
    );
  }

  /**
   * Set remote server configuration
   */
  @IpcMethod()
  async setRemoteServerConfig(config: Partial<DataSyncConfig>) {
    logger.info(
      `Setting remote server storageMode: active=${config.active}, storageMode=${config.storageMode}, url=${config.remoteServerUrl}`,
    );
    const { storeManager } = this.app;
    const prev: DataSyncConfig = storeManager.get('dataSyncConfig');

    // Save configuration with legacy local storage fallback
    const merged = this.normalizeConfig({ ...prev, ...config });
    storeManager.set('dataSyncConfig', merged);

    this.broadcastRemoteServerConfigUpdated();

    return true;
  }

  /**
   * Clear remote server configuration
   */
  @IpcMethod()
  async clearRemoteServerConfig() {
    logger.info('Clearing remote server configuration');
    const { storeManager } = this.app;

    // Clear instance configuration
    storeManager.set('dataSyncConfig', { active: false, storageMode: 'cloud' });

    // Clear tokens (if any)
    await this.clearTokens();

    this.broadcastRemoteServerConfigUpdated();

    return true;
  }

  private broadcastRemoteServerConfigUpdated() {
    logger.debug('Broadcasting remoteServerConfigUpdated event to all windows');
    this.app.browserManager.broadcastToAllWindows('remoteServerConfigUpdated', undefined);
  }

  /**
   * Encrypted tokens
   * Stored in memory for quick access, loaded from persistent storage on init.
   */
  private encryptedAccessToken?: string;
  private encryptedRefreshToken?: string;

  /**
   * Token expiration time (timestamp in milliseconds)
   * Used for automatic token refresh
   */
  private tokenExpiresAt?: number;

  /**
   * Last token refresh time (timestamp in milliseconds)
   * Used to control refresh frequency on app startup/activate
   */
  private lastRefreshAt?: number;

  /**
   * Promise representing the ongoing token refresh operation.
   * Used to prevent concurrent refreshes and allow callers to wait.
   */
  private refreshPromise: Promise<{ error?: string; success: boolean }> | null = null;

  /**
   * Encrypt and store tokens
   * @param accessToken Access token
   * @param refreshToken Refresh token
   * @param expiresIn Token expiration time in seconds (optional)
   */
  async saveTokens(accessToken: string, refreshToken: string, expiresIn?: number) {
    logger.info('Saving encrypted tokens');

    // Calculate expiration time if provided
    if (expiresIn) {
      this.tokenExpiresAt = Date.now() + expiresIn * 1000;
      logger.debug(`Token expires at: ${new Date(this.tokenExpiresAt).toISOString()}`);
    } else {
      this.tokenExpiresAt = undefined;
    }

    // Update last refresh time
    this.lastRefreshAt = Date.now();
    logger.debug(`Token last refreshed at: ${new Date(this.lastRefreshAt).toISOString()}`);

    // If platform doesn't support secure storage, store raw tokens
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('Safe storage not available, storing tokens unencrypted');
      this.encryptedAccessToken = accessToken;
      this.encryptedRefreshToken = refreshToken;
      // Persist unencrypted tokens (consider security implications)
      this.app.storeManager.set(this.encryptedTokensKey, {
        accessToken: this.encryptedAccessToken,
        expiresAt: this.tokenExpiresAt,
        lastRefreshAt: this.lastRefreshAt,
        refreshToken: this.encryptedRefreshToken,
      });
      return;
    }

    // Encrypt tokens
    logger.debug('Encrypting tokens using safe storage');
    this.encryptedAccessToken = Buffer.from(safeStorage.encryptString(accessToken)).toString(
      'base64',
    );

    this.encryptedRefreshToken = Buffer.from(safeStorage.encryptString(refreshToken)).toString(
      'base64',
    );

    // Persist encrypted tokens
    logger.debug(`Persisting encrypted tokens to store key: ${this.encryptedTokensKey}`);
    this.app.storeManager.set(this.encryptedTokensKey, {
      accessToken: this.encryptedAccessToken,
      expiresAt: this.tokenExpiresAt,
      lastRefreshAt: this.lastRefreshAt,
      refreshToken: this.encryptedRefreshToken,
    });
  }

  /**
   * Get decrypted access token
   */
  async getAccessToken(): Promise<string | null> {
    // Try loading from memory first
    if (!this.encryptedAccessToken) {
      logger.debug('Access token not in memory, trying to load from store...');
      this.loadTokensFromStore(); // Attempt to load from persistent storage
    }

    if (!this.encryptedAccessToken) {
      logger.debug('No access token found in memory or store.');
      return null;
    }

    // If platform doesn't support secure storage, return stored token
    if (!safeStorage.isEncryptionAvailable()) {
      logger.debug(
        'Safe storage not available, returning potentially unencrypted token from memory/store',
      );
      return this.encryptedAccessToken;
    }

    try {
      // Decrypt token
      logger.debug('Decrypting access token');
      const encryptedData = Buffer.from(this.encryptedAccessToken, 'base64');
      return safeStorage.decryptString(encryptedData);
    } catch (error) {
      logger.error('Failed to decrypt access token:', error);
      return null;
    }
  }

  /**
   * Get decrypted refresh token
   */
  async getRefreshToken(): Promise<string | null> {
    // Try loading from memory first
    if (!this.encryptedRefreshToken) {
      logger.debug('Refresh token not in memory, trying to load from store...');
      this.loadTokensFromStore(); // Attempt to load from persistent storage
    }

    if (!this.encryptedRefreshToken) {
      logger.debug('No refresh token found in memory or store.');
      return null;
    }

    // If platform doesn't support secure storage, return stored token
    if (!safeStorage.isEncryptionAvailable()) {
      logger.debug(
        'Safe storage not available, returning potentially unencrypted token from memory/store',
      );
      return this.encryptedRefreshToken;
    }

    try {
      // Decrypt token
      logger.debug('Decrypting refresh token');
      const encryptedData = Buffer.from(this.encryptedRefreshToken, 'base64');
      return safeStorage.decryptString(encryptedData);
    } catch (error) {
      logger.error('Failed to decrypt refresh token:', error);
      return null;
    }
  }

  /**
   * Clear tokens
   */
  async clearTokens() {
    logger.info('Clearing access and refresh tokens');
    this.encryptedAccessToken = undefined;
    this.encryptedRefreshToken = undefined;
    this.tokenExpiresAt = undefined;
    // Also clear from persistent storage
    logger.debug(`Deleting tokens from store key: ${this.encryptedTokensKey}`);
    this.app.storeManager.delete(this.encryptedTokensKey);
  }

  /**
   * Get token expiration time
   */
  getTokenExpiresAt(): number | undefined {
    return this.tokenExpiresAt;
  }

  /**
   * Check if token is expired or will expire soon
   * @param bufferTimeMs Buffer time in milliseconds (default 1 day)
   * @returns true if token is expired or will expire soon
   */
  isTokenExpiringSoon(bufferTimeMs: number = 24 * 60 * 60 * 1000): boolean {
    if (!this.tokenExpiresAt) {
      return false; // No expiration time available
    }

    const currentTime = Date.now();
    const bufferTime = this.tokenExpiresAt - bufferTimeMs;

    return currentTime >= bufferTime;
  }

  /**
   * Check if an error is non-retryable
   * Includes OIDC errors (e.g., invalid_grant) and deterministic failures
   * (e.g., missing refresh token, invalid config)
   * @param error Error message to check
   * @returns true if the error should not be retried
   */
  isNonRetryableError(error?: string): boolean {
    if (!error) return false;
    const lowerError = error.toLowerCase();

    // Check OIDC error codes
    if (NON_RETRYABLE_OIDC_ERRORS.some((code) => lowerError.includes(code))) {
      return true;
    }

    // Check deterministic failures that require user intervention
    if (DETERMINISTIC_FAILURES.some((msg) => lowerError.includes(msg))) {
      return true;
    }

    return false;
  }

  /**
   * Refresh access token with retry mechanism
   * Use stored refresh token to obtain a new access token
   * Handles concurrent requests by returning the existing refresh promise if one is in progress.
   * Retries up to 3 times with exponential backoff for transient errors.
   */
  async refreshAccessToken(): Promise<{ error?: string; success: boolean }> {
    // If a refresh is already in progress, return the existing promise
    if (this.refreshPromise) {
      logger.debug('Token refresh already in progress, returning existing promise.');
      return this.refreshPromise;
    }

    // Start a new refresh operation with retry
    logger.info('Initiating new token refresh operation with retry.');
    this.refreshPromise = this.performTokenRefreshWithRetry();

    // Return the promise so callers can wait
    return this.refreshPromise;
  }

  /**
   * Performs token refresh with retry mechanism
   * Uses exponential backoff: 1s, 2s, 4s
   */
  private async performTokenRefreshWithRetry(): Promise<{ error?: string; success: boolean }> {
    try {
      return await retry(
        async (bail, attemptNumber) => {
          logger.debug(`Token refresh attempt ${attemptNumber}/3`);

          const result = await this.performTokenRefresh();

          if (result.success) {
            return result;
          }

          // Check if error is non-retryable
          if (this.isNonRetryableError(result.error)) {
            logger.warn(`Non-retryable error encountered: ${result.error}`);
            // Use bail to stop retrying immediately
            bail(new Error(result.error));
            return result; // This won't be reached, but TypeScript needs it
          }

          // Throw error to trigger retry for transient errors
          throw new Error(result.error);
        },
        {
          factor: 2, // Exponential backoff factor
          maxTimeout: 4000, // Max wait time between retries: 4s
          minTimeout: 1000, // Min wait time between retries: 1s
          onRetry: (err: Error, attempt: number) => {
            logger.info(`Token refresh retry ${attempt}/3: ${err.message}`);
          },
          retries: 3, // Total retry attempts
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Token refresh failed after all retries:', errorMessage);
      return { error: errorMessage, success: false };
    } finally {
      // Ensure the promise reference is cleared once the operation completes
      logger.debug('Clearing the refresh promise reference.');
      this.refreshPromise = null;
    }
  }

  /**
   * Performs the actual token refresh logic.
   * This method is called by refreshAccessToken and wrapped in a promise.
   */
  private async performTokenRefresh(): Promise<{ error?: string; success: boolean }> {
    try {
      // Get configuration information
      const config = await this.getRemoteServerConfig();

      if (!(await this.isRemoteServerConfigured(config))) {
        logger.warn('Remote server not active or configured, skipping refresh.');
        return { error: 'Remote server is not active or configured', success: false };
      }

      // Get refresh token
      const refreshToken = await this.getRefreshToken();
      if (!refreshToken) {
        logger.error('No refresh token available for refresh operation.');
        return { error: 'No refresh token available', success: false };
      }

      // Construct refresh request
      const remoteUrl = await this.getRemoteServerUrl(config);

      const tokenUrl = new URL('/oidc/token', remoteUrl);

      // Construct request body
      const body = querystring.stringify({
        client_id: 'lobehub-desktop',
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      logger.debug(`Sending token refresh request to ${tokenUrl.toString()}`);

      // Send request
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      appendVercelCookie(headers);
      const response = await fetch(tokenUrl.toString(), { body, headers, method: 'POST' });

      if (!response.ok) {
        // Try to parse error response
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = `Token refresh failed: ${response.status} ${response.statusText} ${
          errorData.error_description || errorData.error || ''
        }`.trim();
        logger.error(errorMessage, errorData);
        return { error: errorMessage, success: false };
      }

      // Parse response
      const data = await response.json();

      // Check if response contains necessary tokens
      if (!data.access_token || !data.refresh_token) {
        logger.error('Refresh response missing access_token or refresh_token', data);
        return { error: 'Missing tokens in refresh response', success: false };
      }

      // Save new tokens
      logger.info('Token refresh successful, saving new tokens.');
      await this.saveTokens(data.access_token, data.refresh_token, data.expires_in);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Exception during token refresh operation:', errorMessage, error);
      return { error: `Exception occurred during token refresh: ${errorMessage}`, success: false };
    }
  }

  /**
   * Load encrypted tokens from persistent storage (electron-store) into memory.
   * This should be called during initialization or if memory tokens are missing.
   */
  private loadTokensFromStore() {
    logger.debug(`Attempting to load tokens from store key: ${this.encryptedTokensKey}`);
    const storedTokens = this.app.storeManager.get(this.encryptedTokensKey);

    if (storedTokens && storedTokens.accessToken && storedTokens.refreshToken) {
      logger.info('Successfully loaded tokens from store into memory.');
      this.encryptedAccessToken = storedTokens.accessToken;
      this.encryptedRefreshToken = storedTokens.refreshToken;
      this.tokenExpiresAt = storedTokens.expiresAt;
      this.lastRefreshAt = storedTokens.lastRefreshAt;

      if (this.tokenExpiresAt) {
        logger.debug(
          `Loaded token expiration time: ${new Date(this.tokenExpiresAt).toISOString()}`,
        );
      }
      if (this.lastRefreshAt) {
        logger.debug(`Loaded last refresh time: ${new Date(this.lastRefreshAt).toISOString()}`);
      }
    } else {
      logger.debug('No valid tokens found in store.');
    }
  }

  /**
   * Get the last token refresh time
   * @returns The timestamp (in milliseconds) of the last token refresh, or undefined if never refreshed
   */
  getLastTokenRefreshAt(): number | undefined {
    return this.lastRefreshAt;
  }

  // Initialize by loading tokens from store when the controller is ready
  // We might need a dedicated lifecycle method if constructor is too early for storeManager
  afterAppReady() {
    this.loadTokensFromStore();
  }

  async getRemoteServerUrl(config?: DataSyncConfig) {
    const dataConfig = this.normalizeConfig(config ? config : await this.getRemoteServerConfig());

    return dataConfig.storageMode === 'cloud' ? OFFICIAL_CLOUD_SERVER : dataConfig.remoteServerUrl;
  }

  /**
   * Setup subscription webview session with OIDC token injection
   * This configures a webRequest interceptor on the given partition session
   * to automatically inject the Oidc-Auth token header for official domain requests.
   * @param params.partition The partition name for the webview session
   */
  @IpcMethod()
  async setupSubscriptionWebviewSession(params: { partition: string }) {
    const { partition } = params;

    logger.info(`Setting up subscription webview session for partition: ${partition}`);

    const session = electronSession.fromPartition(partition);

    session.webRequest.onBeforeSendHeaders(
      { urls: [`https://*.lobehub.com/*`] },
      async (details, callback) => {
        const requestHeaders = { ...details.requestHeaders };

        const token = await this.getAccessToken();

        if (token) {
          requestHeaders['Oidc-Auth'] = token;
          logger.debug(`Injected Oidc-Auth token for: ${details.url}`);
        }

        callback({ requestHeaders });
      },
    );

    logger.debug(`Subscription webview session setup completed for partition: ${partition}`);

    return { success: true };
  }
}
