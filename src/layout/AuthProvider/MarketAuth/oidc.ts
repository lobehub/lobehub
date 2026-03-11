import { isDesktop } from '@/const/version';
import { MARKET_OIDC_ENDPOINTS } from '@/services/_url';

import { MarketAuthError } from './errors';
import {
  clearMarketAuthResult,
  getMarketAuthResultStorageKey,
  type MarketAuthHandoffPayload,
  readMarketAuthResult,
  resolveMarketAuthHandoffPayload,
} from './handoff';
import { type OIDCConfig, type PKCEParams, type TokenResponse } from './types';

/**
 * Market OIDC authorization utility class
 */
export class MarketOIDC {
  private config: OIDCConfig;

  private static readonly DESKTOP_HANDOFF_CLIENT = 'desktop';

  private static readonly DESKTOP_HANDOFF_POLL_INTERVAL = 1500;

  private static readonly DESKTOP_HANDOFF_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  private static readonly WEB_POPUP_CLOSE_GRACE_PERIOD = 1500;

  private static readonly WEB_POPUP_MONITOR_INTERVAL = 500;

  private static readonly WEB_POPUP_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  constructor(config: OIDCConfig) {
    this.config = config;
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    console.info('[MarketOIDC] Generating PKCE code verifier');
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, Array.from(array)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  /**
   * Generate PKCE code challenge
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    console.info('[MarketOIDC] Generating PKCE code challenge');
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  /**
   * Generate random state
   */
  private generateState(): string {
    console.info('[MarketOIDC] Generating random state');
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, Array.from(array)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  /**
   * Generate PKCE parameters
   */
  async generatePKCEParams(): Promise<PKCEParams> {
    console.info('[MarketOIDC] Generating PKCE parameters');
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = this.generateState();

    // Store parameters in sessionStorage for subsequent verification
    sessionStorage.setItem('market_code_verifier', codeVerifier);
    sessionStorage.setItem('market_state', state);

    console.info('[MarketOIDC] PKCE parameters generated and stored');
    return {
      codeChallenge,
      codeVerifier,
      state,
    };
  }

  /**
   * Build authorization URL
   */
  async buildAuthUrl(): Promise<string> {
    console.info('[MarketOIDC] Building authorization URL');
    const pkceParams = await this.generatePKCEParams();

    console.info('[MarketOIDC] this.config:', this.config);

    const authUrl = new URL(MARKET_OIDC_ENDPOINTS.auth, this.config.baseUrl);
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.config.scope);
    authUrl.searchParams.set('state', pkceParams.state);
    authUrl.searchParams.set('code_challenge', pkceParams.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.info('[MarketOIDC] Authorization URL built:', authUrl.toString());
    return authUrl.toString();
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, state: string): Promise<TokenResponse> {
    console.info('[MarketOIDC] Exchanging authorization code for token');

    // Validate state parameter
    const storedState = sessionStorage.getItem('market_state');
    if (state !== storedState) {
      console.error('[MarketOIDC] State parameter mismatch');
      throw new MarketAuthError('stateMismatch', { message: 'Invalid state parameter' });
    }

    // Get stored code verifier
    const codeVerifier = sessionStorage.getItem('market_code_verifier');
    if (!codeVerifier) {
      console.error('[MarketOIDC] Code verifier not found');
      throw new MarketAuthError('codeVerifierMissing', { message: 'Code verifier not found' });
    }

    const tokenUrl = MARKET_OIDC_ENDPOINTS.token;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    });
    const response = await fetch(tokenUrl, {
      body: body.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => undefined);
      const errorMessage =
        `Token exchange failed: ${response.status} ${response.statusText} ${errorData?.error_description || errorData?.error || ''}`.trim();
      console.error('[MarketOIDC]', errorMessage);
      throw new MarketAuthError('authorizationFailed', {
        message: errorMessage,
        meta: {
          error: errorData,
          status: response.status,
          statusText: response.statusText,
        },
      });
    }

    const tokenData = (await response.json()) as TokenResponse;
    console.info('[MarketOIDC] Token exchange successful');

    // Clean up temporary data in sessionStorage
    sessionStorage.removeItem('market_code_verifier');
    sessionStorage.removeItem('market_state');

    return tokenData;
  }

  /**
   * Start authorization flow and return authorization result
   */
  async startAuthorization(): Promise<{ code: string; state: string }> {
    const authUrl = await this.buildAuthUrl();

    if (typeof window === 'undefined') {
      throw new MarketAuthError('browserOnly', {
        message: 'Authorization can only be initiated in a browser environment.',
      });
    }

    const state = sessionStorage.getItem('market_state');
    if (!state) {
      console.error('[MarketOIDC] Missing state parameter in session storage');
      throw new MarketAuthError('stateMissing', {
        message: 'Authorization state not found. Please try again.',
      });
    }

    // Open authorization page in a new window
    let popup: Window | null = null;
    if (isDesktop) {
      // Electron desktop: use IPC to call the main process to open the system browser
      console.info('[MarketOIDC] Desktop app detected, opening system browser via IPC');
      const { remoteServerService } = await import('@/services/electron/remoteServer');

      try {
        const result = await remoteServerService.requestMarketAuthorization({ authUrl });
        if (!result.success) {
          console.error('[MarketOIDC] Failed to open system browser:', result.error);
          throw new MarketAuthError('openBrowserFailed', {
            message: result.error || 'Failed to open system browser',
            meta: { error: result.error },
          });
        }
        console.info('[MarketOIDC] System browser opened successfully');
      } catch (error) {
        console.error('[MarketOIDC] Exception opening system browser:', error);
        throw new MarketAuthError('openBrowserFailed', {
          cause: error,
          message: 'Failed to open system browser. Please try again.',
        });
      }

      return this.pollDesktopHandoff(state);
    } else {
      // Browser environment: use window.open to open a popup
      popup = window.open(
        authUrl,
        'market_auth',
        'width=580,height=720,scrollbars=yes,resizable=yes',
      );

      if (!popup) {
        console.error('[MarketOIDC] Failed to open authorization popup');
        throw new MarketAuthError('openPopupFailed', {
          message: 'Failed to open authorization popup. Please check popup blocker settings.',
        });
      }
    }

    clearMarketAuthResult(state);

    return new Promise((resolve, reject) => {
      let checkClosed: number | undefined;
      let fallbackPolling: number | undefined;
      let popupClosedGraceTimeout: number | undefined;

      const authTimeout = setTimeout(() => {
        cleanup();
        reject(
          new MarketAuthError('handoffTimeout', {
            message:
              'Authorization timeout. Please complete the authorization in the browser and try again.',
          }),
        );
      }, MarketOIDC.WEB_POPUP_TIMEOUT) as unknown as number;

      const cleanup = () => {
        window.removeEventListener('message', messageHandler);
        window.removeEventListener('storage', storageHandler);
        clearTimeout(authTimeout);
        if (checkClosed) clearInterval(checkClosed);
        if (fallbackPolling) clearInterval(fallbackPolling);
        if (popupClosedGraceTimeout) clearTimeout(popupClosedGraceTimeout);
        clearMarketAuthResult(state);
      };

      const settle = (payload: MarketAuthHandoffPayload) => {
        cleanup();

        if (payload.type === 'MARKET_AUTH_SUCCESS') {
          resolve({
            code: payload.code,
            state: payload.state,
          });

          return;
        }

        try {
          popup?.close();
        } catch {
          // Ignore close failures from cross-origin popup contexts.
        }

        reject(
          new MarketAuthError('authorizationFailed', {
            message: payload.error || 'Authorization failed',
            meta: { error: payload.error },
          }),
        );
      };

      const handleHandoffPayload = (payload: MarketAuthHandoffPayload | null) => {
        if (!payload) return false;
        if (payload.state && payload.state !== state) return false;

        settle(payload);
        return true;
      };

      const flushStoredResult = () => handleHandoffPayload(readMarketAuthResult(state));

      const startStoragePolling = () => {
        if (fallbackPolling) return;

        fallbackPolling = setInterval(() => {
          flushStoredResult();
        }, MarketOIDC.WEB_POPUP_MONITOR_INTERVAL) as unknown as number;
      };

      const rejectPopupClosed = () => {
        cleanup();
        reject(new MarketAuthError('popupClosed', { message: 'Authorization popup was closed' }));
      };

      const handlePopupClosed = () => {
        if (popupClosedGraceTimeout) return;
        if (checkClosed) {
          clearInterval(checkClosed);
          checkClosed = undefined;
        }

        if (flushStoredResult()) return;

        startStoragePolling();

        popupClosedGraceTimeout = setTimeout(() => {
          if (flushStoredResult()) return;
          rejectPopupClosed();
        }, MarketOIDC.WEB_POPUP_CLOSE_GRACE_PERIOD) as unknown as number;
      };

      // Listen for message events, waiting for authorization to complete
      const messageHandler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        console.info('[MarketOIDC] Received message from popup:', event.data);

        handleHandoffPayload(resolveMarketAuthHandoffPayload(event.data));
      };

      const storageHandler = (event: StorageEvent) => {
        if (event.storageArea !== localStorage) return;
        if (event.key !== getMarketAuthResultStorageKey(state)) return;

        if (!event.newValue) {
          flushStoredResult();
          return;
        }

        try {
          handleHandoffPayload(resolveMarketAuthHandoffPayload(JSON.parse(event.newValue)));
        } catch {
          // Ignore malformed storage payloads and keep waiting for a valid handoff.
        }
      };

      window.addEventListener('message', messageHandler);
      window.addEventListener('storage', storageHandler);

      if (flushStoredResult()) return;

      // Check if the popup was closed. A readable `closed === true` means the
      // window is genuinely gone, so only wait a short grace period for the
      // callback page to persist its handoff result. If accessing popup state
      // throws, assume COOP isolation and keep waiting on storage handoff.
      if (popup) {
        checkClosed = setInterval(() => {
          try {
            if (popup.closed) {
              handlePopupClosed();
            }
          } catch {
            console.info(
              '[MarketOIDC] COOP blocked popup monitoring, falling back to storage handoff',
            );

            if (checkClosed) {
              clearInterval(checkClosed);
              checkClosed = undefined;
            }

            startStoragePolling();
          }
        }, MarketOIDC.WEB_POPUP_MONITOR_INTERVAL) as unknown as number;
      }
    });
  }

  /**
   * Poll the handoff endpoint to get the desktop authorization result
   */
  private async pollDesktopHandoff(state: string): Promise<{ code: string; state: string }> {
    console.info('[MarketOIDC] Starting desktop handoff polling with state:', state);

    const startTime = Date.now();

    const pollUrl = `${MARKET_OIDC_ENDPOINTS.handoff}?id=${encodeURIComponent(
      state,
    )}&client=${encodeURIComponent(MarketOIDC.DESKTOP_HANDOFF_CLIENT)}`;

    console.info('[MarketOIDC] Poll URL:', pollUrl);

    while (Date.now() - startTime < MarketOIDC.DESKTOP_HANDOFF_TIMEOUT) {
      try {
        const response = await fetch(pollUrl, {
          cache: 'no-store',
          credentials: 'include',
        });

        const data = await response.json().catch(() => undefined);

        console.info('[MarketOIDC] Poll response:', response.status, data);

        if (
          response.status === 200 &&
          data?.status === 'success' &&
          typeof data?.code === 'string'
        ) {
          console.info('[MarketOIDC] Desktop handoff succeeded');
          return {
            code: data.code,
            state,
          };
        }

        if (response.status === 202 || data?.status === 'pending') {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, MarketOIDC.DESKTOP_HANDOFF_POLL_INTERVAL);
          });
          continue;
        }

        if (response.status === 404 || data?.status === 'consumed') {
          throw new MarketAuthError('codeConsumed', {
            message: 'Authorization code already consumed. Please retry.',
          });
        }

        if (response.status === 410 || data?.status === 'expired') {
          throw new MarketAuthError('sessionExpired', {
            message: 'Authorization session expired. Please restart the sign-in process.',
          });
        }

        const errorMessage =
          data?.error || data?.message || `Handoff request failed with status ${response.status}`;
        console.error('[MarketOIDC] Handoff polling failed:', errorMessage);
        throw new MarketAuthError('handoffFailed', {
          message: errorMessage,
          meta: { data, status: response.status },
        });
      } catch (error) {
        console.error('[MarketOIDC] Error while polling handoff endpoint:', error);
        if (error instanceof MarketAuthError) {
          throw error;
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to retrieve authorization result from handoff endpoint.';
        throw new MarketAuthError('handoffFailed', {
          cause: error,
          message,
        });
      }
    }

    console.warn('[MarketOIDC] Desktop handoff polling timed out');
    throw new MarketAuthError('handoffTimeout', {
      message:
        'Authorization timeout. Please complete the authorization in the browser and try again.',
    });
  }
}
