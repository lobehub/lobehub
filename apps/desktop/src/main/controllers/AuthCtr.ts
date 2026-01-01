import { DataSyncConfig, MarketAuthorizationParams } from '@lobechat/electron-client-ipc';
import { BrowserWindow, shell } from 'electron';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { URL } from 'node:url';

import { createLogger } from '@/utils/logger';

import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import { ControllerModule, IpcMethod } from './index';

// Create logger
const logger = createLogger('controllers:AuthCtr');

/**
 * Authentication Controller
 * Implements OAuth authorization flow using intermediate page + polling mechanism
 */
export default class AuthCtr extends ControllerModule {
  static override readonly groupName = 'auth';
  /**
   * Remote server configuration controller
   */
  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  /**
   * Current PKCE parameters
   */
  private codeVerifier: string | null = null;
  private authRequestState: string | null = null;

  /**
   * Polling related parameters
   */
  // eslint-disable-next-line no-undef
  private pollingInterval: NodeJS.Timeout | null = null;
  private cachedRemoteUrl: string | null = null;

  /**
   * Auto-refresh timer
   */
  // eslint-disable-next-line no-undef
  private autoRefreshTimer: NodeJS.Timeout | null = null;

  /**
   * Construct redirect_uri, ensuring the same URI is used for authorization and token exchange
   * @param remoteUrl Remote server URL
   */
  private constructRedirectUri(remoteUrl: string): string {
    const callbackUrl = new URL('/oidc/callback/desktop', remoteUrl);

    return callbackUrl.toString();
  }

  /**
   * Request OAuth authorization
   */
  @IpcMethod()
  async requestAuthorization(config: DataSyncConfig) {
    // Clear any old authorization state
    this.clearAuthorizationState();

    const remoteUrl = await this.remoteServerConfigCtr.getRemoteServerUrl(config);

    // Cache remote server URL for subsequent polling
    this.cachedRemoteUrl = remoteUrl;

    logger.info(
      `Requesting OAuth authorization, storageMode:${config.storageMode} server URL: ${remoteUrl}`,
    );
    try {
      // Generate PKCE parameters
      logger.debug('Generating PKCE parameters');
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);
      this.codeVerifier = codeVerifier;

      // Generate state parameter to prevent CSRF attacks
      this.authRequestState = crypto.randomBytes(16).toString('hex');
      logger.debug(`Generated state parameter: ${this.authRequestState}`);

      // Construct authorization URL with new redirect_uri
      const authUrl = new URL('/oidc/auth', remoteUrl);
      const redirectUri = this.constructRedirectUri(remoteUrl);

      logger.info('redirectUri', redirectUri);

      // Add query parameters
      authUrl.search = querystring.stringify({
        client_id: 'lobehub-desktop',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
        redirect_uri: redirectUri,
        // https://github.com/lobehub/lobe-chat/pull/8450
        resource: 'urn:lobehub:chat',
        response_type: 'code',
        scope: 'profile email offline_access',
        state: this.authRequestState,
      });

      logger.info(`Constructed authorization URL: ${authUrl.toString()}`);

      // Open authorization URL in the default browser
      await shell.openExternal(authUrl.toString());
      logger.debug('Opening authorization URL in default browser');

      // Start polling for credentials
      this.startPolling();

      return { success: true };
    } catch (error) {
      logger.error('Authorization request failed:', error);
      return { error: error.message, success: false };
    }
  }

  /**
   * Request Market OAuth authorization (desktop)
   */
  @IpcMethod()
  async requestMarketAuthorization(params: MarketAuthorizationParams) {
    const { authUrl } = params;

    if (!authUrl) {
      const errorMessage = 'Market authorization URL is required';
      logger.error(errorMessage);
      return { error: errorMessage, success: false };
    }

    logger.info(`Requesting market authorization via: ${authUrl}`);
    try {
      await shell.openExternal(authUrl);
      logger.debug('Opening market authorization URL in default browser');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Market authorization request failed:', error);
      return { error: message, success: false };
    }
  }

  /**
   * 启动轮询机制获取凭证
   */
  private startPolling() {
    if (!this.authRequestState) {
      logger.error('No handoff ID available for polling');
      return;
    }

    logger.info('Starting credential polling');
    const pollInterval = 3000; // 3 seconds
    const maxPollTime = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();

    this.pollingInterval = setInterval(async () => {
      try {
        // Check if polling has timed out
        if (Date.now() - startTime > maxPollTime) {
          logger.warn('Credential polling timed out');
          this.clearAuthorizationState();
          this.broadcastAuthorizationFailed('Authorization timed out');
          return;
        }

        // Poll for credentials
        const result = await this.pollForCredentials();

        if (result) {
          logger.info('Successfully received credentials from polling');
          this.stopPolling();

          // Validate state parameter
          if (result.state !== this.authRequestState) {
            logger.error(
              `Invalid state parameter: expected ${this.authRequestState}, received ${result.state}`,
            );
            this.broadcastAuthorizationFailed('Invalid state parameter');
            return;
          }

          // Exchange code for tokens
          const exchangeResult = await this.exchangeCodeForToken(result.code, this.codeVerifier!);

          if (exchangeResult.success) {
            logger.info('Authorization successful');
            this.broadcastAuthorizationSuccessful();
          } else {
            logger.warn(`Authorization failed: ${exchangeResult.error || 'Unknown error'}`);
            this.broadcastAuthorizationFailed(exchangeResult.error || 'Unknown error');
          }
        }
      } catch (error) {
        logger.error('Error during credential polling:', error);
        this.clearAuthorizationState();
        this.broadcastAuthorizationFailed('Polling error: ' + error.message);
      }
    }, pollInterval);
  }

  /**
   * Stop polling
   */
  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Clear authorization state
   * Called before starting a new authorization flow or after authorization failure/timeout
   */
  private clearAuthorizationState() {
    logger.debug('Clearing authorization state');
    this.stopPolling();
    this.codeVerifier = null;
    this.authRequestState = null;
    this.cachedRemoteUrl = null;
  }

  /**
   * Start auto-refresh timer
   */
  private startAutoRefresh() {
    // Stop existing timer first
    this.stopAutoRefresh();

    const checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    logger.debug('Starting auto-refresh timer');

    this.autoRefreshTimer = setInterval(async () => {
      try {
        // Check if token is expiring soon (refresh 5 minutes in advance)
        if (this.remoteServerConfigCtr.isTokenExpiringSoon()) {
          const expiresAt = this.remoteServerConfigCtr.getTokenExpiresAt();
          logger.info(
            `Token is expiring soon, triggering auto-refresh. Expires at: ${expiresAt ? new Date(expiresAt).toISOString() : 'unknown'}`,
          );

          const result = await this.remoteServerConfigCtr.refreshAccessToken();
          if (result.success) {
            logger.info('Auto-refresh successful');
            this.broadcastTokenRefreshed();
          } else {
            logger.error(`Auto-refresh failed after retries: ${result.error}`);

            // Only clear tokens for non-retryable errors (e.g., invalid_grant)
            // The retry mechanism in RemoteServerConfigCtr already handles transient errors
            if (this.remoteServerConfigCtr.isNonRetryableError(result.error)) {
              logger.warn(
                'Non-retryable error detected, clearing tokens and requiring re-authorization',
              );
              this.stopAutoRefresh();
              await this.remoteServerConfigCtr.clearTokens();
              await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
              this.broadcastAuthorizationRequired();
            } else {
              // For other errors (after retries exhausted), log but don't clear tokens immediately
              // The next refresh cycle will retry
              logger.warn('Refresh failed but error may be transient, will retry on next cycle');
            }
          }
        }
      } catch (error) {
        logger.error('Error during auto-refresh check:', error);
      }
    }, checkInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  private stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      logger.debug('Stopped auto-refresh timer');
    }
  }

  /**
   * Poll for credentials
   * Sends HTTP request directly to remote server
   */
  private async pollForCredentials(): Promise<{ code: string; state: string } | null> {
    if (!this.authRequestState || !this.cachedRemoteUrl) {
      return null;
    }

    try {
      // Use cached remote server URL
      const remoteUrl = this.cachedRemoteUrl;

      // Construct request URL
      const url = new URL('/oidc/handoff', remoteUrl);
      url.searchParams.set('id', this.authRequestState);
      url.searchParams.set('client', 'desktop');

      logger.debug(`Polling for credentials: ${url.toString()}`);

      // Send HTTP request directly
      const response = await fetch(url.toString(), {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'GET',
      });

      // Check response status
      if (response.status === 404) {
        // Credentials not ready yet, this is normal
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse response data
      const data = (await response.json()) as {
        data: {
          id: string;
          payload: { code: string; state: string };
        };
        success: boolean;
      };

      if (data.success && data.data?.payload) {
        logger.debug('Successfully retrieved credentials from handoff');
        return {
          code: data.data.payload.code,
          state: data.data.payload.state,
        };
      }

      return null;
    } catch (error) {
      logger.debug('Polling attempt failed (this is normal):', error.message);
      return null;
    }
  }

  /**
   * Refresh access token
   * This method includes retry mechanism via RemoteServerConfigCtr.refreshAccessToken()
   */
  async refreshAccessToken() {
    logger.info('Starting to refresh access token');
    try {
      // Call the centralized refresh logic in RemoteServerConfigCtr (includes retry)
      const result = await this.remoteServerConfigCtr.refreshAccessToken();

      if (result.success) {
        logger.info('Token refresh successful via AuthCtr call.');
        // Notify render process that token has been refreshed
        this.broadcastTokenRefreshed();
        // Restart auto-refresh timer with new expiration time
        this.startAutoRefresh();
        return { success: true };
      } else {
        logger.error(`Token refresh failed via AuthCtr call: ${result.error}`);

        // Only clear tokens for non-retryable errors (e.g., invalid_grant)
        if (this.remoteServerConfigCtr.isNonRetryableError(result.error)) {
          logger.warn(
            'Non-retryable error detected, clearing tokens and requiring re-authorization',
          );
          this.stopAutoRefresh();
          await this.remoteServerConfigCtr.clearTokens();
          await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
          this.broadcastAuthorizationRequired();
        } else {
          // For transient errors, don't clear tokens - allow manual retry
          logger.warn('Refresh failed but error may be transient, tokens preserved for retry');
        }

        return { error: result.error, success: false };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Token refresh operation failed via AuthCtr:', errorMessage);

      // Only clear tokens for non-retryable errors
      if (this.remoteServerConfigCtr.isNonRetryableError(errorMessage)) {
        logger.warn('Non-retryable error in catch block, clearing tokens');
        this.stopAutoRefresh();
        await this.remoteServerConfigCtr.clearTokens();
        await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
        this.broadcastAuthorizationRequired();
      }

      return { error: errorMessage, success: false };
    }
  }

  /**
   * Exchange authorization code for token
   */
  private async exchangeCodeForToken(code: string, codeVerifier: string) {
    if (!this.cachedRemoteUrl) {
      throw new Error('No cached remote URL available for token exchange');
    }

    const remoteUrl = this.cachedRemoteUrl;
    logger.info('Starting to exchange authorization code for token');
    try {
      const tokenUrl = new URL('/oidc/token', remoteUrl);
      logger.debug(`Constructed token exchange URL: ${tokenUrl.toString()}`);

      // Construct request body
      const body = querystring.stringify({
        client_id: 'lobehub-desktop',
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.constructRedirectUri(remoteUrl),
      });

      logger.debug('Sending token exchange request');
      // Send request to get token
      const response = await fetch(tokenUrl.toString(), {
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      });

      if (!response.ok) {
        // Try parsing the error response
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = `Failed to get token: ${response.status} ${response.statusText} ${errorData.error_description || errorData.error || ''}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      let data;

      // Parse response
      try {
        data = await response.clone().json();
      } catch {
        const status = response.status;

        throw new Error(
          `Parse JSON failed, please check your server, response status: ${status}, detail:\n\n ${await response.text()} `,
        );
      }

      logger.debug('Successfully received token exchange response');

      // Ensure response contains necessary fields
      if (!data.access_token || !data.refresh_token) {
        logger.error('Invalid token response: missing access_token or refresh_token');
        throw new Error('Invalid token response: missing required fields');
      }

      // Save tokens
      logger.debug('Starting to save exchanged tokens');
      await this.remoteServerConfigCtr.saveTokens(
        data.access_token,
        data.refresh_token,
        data.expires_in,
      );
      logger.info('Successfully saved exchanged tokens');

      // Set server to active state
      logger.debug(`Setting remote server to active state: ${remoteUrl}`);
      await this.remoteServerConfigCtr.setRemoteServerConfig({ active: true });

      // Start auto-refresh timer
      this.startAutoRefresh();

      return { success: true };
    } catch (error) {
      logger.error('Exchanging authorization code failed:', error);
      return { error: error.message, success: false };
    }
  }

  /**
   * Broadcast token refreshed event
   */
  private broadcastTokenRefreshed() {
    logger.debug('Broadcasting tokenRefreshed event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('tokenRefreshed');
      }
    }
  }

  /**
   * Broadcast authorization successful event
   */
  private broadcastAuthorizationSuccessful() {
    logger.debug('Broadcasting authorizationSuccessful event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationSuccessful');
      }
    }
  }

  /**
   * Broadcast authorization failed event
   */
  private broadcastAuthorizationFailed(error: string) {
    logger.debug(`Broadcasting authorizationFailed event to all windows, error: ${error}`);
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationFailed', { error });
      }
    }
  }

  /**
   * Broadcast authorization required event
   */
  private broadcastAuthorizationRequired() {
    logger.debug('Broadcasting authorizationRequired event to all windows');
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationRequired');
      }
    }
  }

  /**
   * Generate PKCE codeVerifier
   */
  private generateCodeVerifier(): string {
    logger.debug('Generating PKCE code verifier');
    // Generate a random string of at least 43 characters
    const verifier = crypto
      .randomBytes(32)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    logger.debug('Generated code verifier (partial): ' + verifier.slice(0, 10) + '...'); // Avoid logging full sensitive info
    return verifier;
  }

  /**
   * Generate codeChallenge from codeVerifier (S256 method)
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    logger.debug('Generating PKCE code challenge (S256)');
    // Hash codeVerifier using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data as unknown as NodeJS.BufferSource);

    // Convert hash result to base64url encoding
    const challenge = Buffer.from(digest)
      .toString('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    logger.debug('Generated code challenge (partial): ' + challenge.slice(0, 10) + '...'); // Avoid logging full sensitive info
    return challenge;
  }

  /**
   * Initialize after app is ready
   */
  afterAppReady() {
    logger.debug('AuthCtr initialized, checking for existing tokens');
    this.initializeAutoRefresh();
  }

  /**
   * Clean up all timers
   */
  cleanup() {
    logger.debug('Cleaning up AuthCtr timers');
    this.stopPolling();
    this.stopAutoRefresh();
  }

  /**
   * Initialize auto-refresh functionality
   * Checks for valid token at app startup and starts auto-refresh timer if token exists
   */
  private async initializeAutoRefresh() {
    try {
      const config = await this.remoteServerConfigCtr.getRemoteServerConfig();

      // Check if remote server is configured and active
      if (!config.active || !config.remoteServerUrl) {
        logger.debug(
          'Remote server not active or configured, skipping auto-refresh initialization',
        );
        return;
      }

      // Check if valid access token exists
      const accessToken = await this.remoteServerConfigCtr.getAccessToken();
      if (!accessToken) {
        logger.debug('No access token found, skipping auto-refresh initialization');
        return;
      }

      // Check if token expiration time exists
      const expiresAt = this.remoteServerConfigCtr.getTokenExpiresAt();
      if (!expiresAt) {
        logger.debug('No token expiration time found, skipping auto-refresh initialization');
        return;
      }

      // Check if token has already expired
      const currentTime = Date.now();
      if (currentTime >= expiresAt) {
        logger.info('Token has expired, attempting to refresh it');

        // Attempt to refresh token (includes retry mechanism)
        const refreshResult = await this.remoteServerConfigCtr.refreshAccessToken();
        if (refreshResult.success) {
          logger.info('Token refresh successful during initialization');
          this.broadcastTokenRefreshed();
          // Restart auto-refresh timer
          this.startAutoRefresh();
          return;
        } else {
          logger.error(`Token refresh failed during initialization: ${refreshResult.error}`);

          // Only clear token for non-retryable errors
          if (this.remoteServerConfigCtr.isNonRetryableError(refreshResult.error)) {
            logger.warn('Non-retryable error during initialization, clearing tokens');
            await this.remoteServerConfigCtr.clearTokens();
            await this.remoteServerConfigCtr.setRemoteServerConfig({ active: false });
            this.broadcastAuthorizationRequired();
          } else {
            // For transient errors, still start auto-refresh timer to retry later
            logger.warn('Transient error during initialization, will retry via auto-refresh');
            this.startAutoRefresh();
          }
          return;
        }
      }

      // Start auto-refresh timer
      logger.info(
        `Token is valid, starting auto-refresh timer. Token expires at: ${new Date(expiresAt).toISOString()}`,
      );
      this.startAutoRefresh();
    } catch (error) {
      logger.error('Error during auto-refresh initialization:', error);
    }
  }
}
