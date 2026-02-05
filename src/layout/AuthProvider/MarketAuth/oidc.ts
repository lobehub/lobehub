import { isDesktop } from '@/const/version';
import { MARKET_OIDC_ENDPOINTS } from '@/services/_url';

import { MarketAuthError } from './errors';
import type {OIDCConfig, PKCEParams, TokenResponse} from './types';

/**
 * Market OIDC 授权工具类
 */
export class MarketOIDC {
  private config: OIDCConfig;

  private static readonly DESKTOP_HANDOFF_CLIENT = 'desktop';

  private static readonly DESKTOP_HANDOFF_POLL_INTERVAL = 1500;

  private static readonly DESKTOP_HANDOFF_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  constructor(config: OIDCConfig) {
    this.config = config;
  }

  /**
   * 生成 PKCE code verifier
   */
  private generateCodeVerifier(): string {
    console.log('[MarketOIDC] Generating PKCE code verifier');
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, Array.from(array)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  /**
   * 生成 PKCE code challenge
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    console.log('[MarketOIDC] Generating PKCE code challenge');
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  /**
   * 生成随机 state
   */
  private generateState(): string {
    console.log('[MarketOIDC] Generating random state');
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, Array.from(array)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  /**
   * 生成 PKCE 参数
   */
  async generatePKCEParams(): Promise<PKCEParams> {
    console.log('[MarketOIDC] Generating PKCE parameters');
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = this.generateState();

    // 将参数存储到 sessionStorage 用于后续验证
    sessionStorage.setItem('market_code_verifier', codeVerifier);
    sessionStorage.setItem('market_state', state);

    console.log('[MarketOIDC] PKCE parameters generated and stored');
    return {
      codeChallenge,
      codeVerifier,
      state,
    };
  }

  /**
   * 构建授权 URL
   */
  async buildAuthUrl(): Promise<string> {
    console.log('[MarketOIDC] Building authorization URL');
    const pkceParams = await this.generatePKCEParams();

    console.log('[MarketOIDC] this.config:', this.config);

    const authUrl = new URL(MARKET_OIDC_ENDPOINTS.auth, this.config.baseUrl);
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.config.scope);
    authUrl.searchParams.set('state', pkceParams.state);
    authUrl.searchParams.set('code_challenge', pkceParams.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log('[MarketOIDC] Authorization URL built:', authUrl.toString());
    return authUrl.toString();
  }

  /**
   * 用授权码换取访问令牌
   */
  async exchangeCodeForToken(code: string, state: string): Promise<TokenResponse> {
    console.log('[MarketOIDC] Exchanging authorization code for token');

    // 验证 state 参数
    const storedState = sessionStorage.getItem('market_state');
    if (state !== storedState) {
      console.error('[MarketOIDC] State parameter mismatch');
      throw new MarketAuthError('stateMismatch', { message: 'Invalid state parameter' });
    }

    // 获取存储的 code verifier
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
    console.log('[MarketOIDC] Token exchange successful');

    // 清理 sessionStorage 中的临时数据
    sessionStorage.removeItem('market_code_verifier');
    sessionStorage.removeItem('market_state');

    return tokenData;
  }

  /**
   * 启动授权流程并返回授权结果
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

    // 在新窗口中打开授权页面
    let popup: Window | null = null;
    if (isDesktop) {
      // Electron 桌面端：使用 IPC 调用主进程打开系统浏览器
      console.log('[MarketOIDC] Desktop app detected, opening system browser via IPC');
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
        console.log('[MarketOIDC] System browser opened successfully');
      } catch (error) {
        console.error('[MarketOIDC] Exception opening system browser:', error);
        throw new MarketAuthError('openBrowserFailed', {
          cause: error,
          message: 'Failed to open system browser. Please try again.',
        });
      }

      return this.pollDesktopHandoff(state);
    } else {
      // 浏览器环境：使用 window.open 打开弹窗
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

    return new Promise((resolve, reject) => {
      let checkClosed: number | undefined;

      // 先声明，后定义，避免相互“定义前使用”
      let messageHandler: (event: MessageEvent) => void;

      // 清理函数
      function cleanup() {
        window.removeEventListener('message', messageHandler);
        if (checkClosed) clearInterval(checkClosed);
      }

      // 监听消息事件，等待授权完成
      messageHandler = (event: MessageEvent) => {
        console.log('[MarketOIDC] Received message from popup:', event.data);

        if (event.data.type === 'MARKET_AUTH_SUCCESS') {
          cleanup();

          // 不立即关闭弹窗，让用户看到成功状态
          // 弹窗会在3秒后自动关闭
          resolve({
            code: event.data.code,
            state: event.data.state,
          });
        } else if (event.data.type === 'MARKET_AUTH_ERROR') {
          cleanup();
          popup?.close();
          reject(
            new MarketAuthError('authorizationFailed', {
              message: event.data.error || 'Authorization failed',
              meta: { error: event.data.error },
            }),
          );
        }
      };

      window.addEventListener('message', messageHandler);

      // 检查弹窗是否被关闭
      if (popup) {
        checkClosed = setInterval(() => {
          if (popup.closed) {
            cleanup();
            reject(
              new MarketAuthError('popupClosed', { message: 'Authorization popup was closed' }),
            );
          }
        }, 1000) as unknown as number;
      }
    });
  }

  /**
   * 轮询 handoff 接口获取桌面端授权结果
   */
  private async pollDesktopHandoff(state: string): Promise<{ code: string; state: string }> {
    console.log('[MarketOIDC] Starting desktop handoff polling with state:', state);

    const startTime = Date.now();

    const pollUrl = `${MARKET_OIDC_ENDPOINTS.handoff}?id=${encodeURIComponent(
      state,
    )}&client=${encodeURIComponent(MarketOIDC.DESKTOP_HANDOFF_CLIENT)}`;

    console.log('[MarketOIDC] Poll URL:', pollUrl);

    while (Date.now() - startTime < MarketOIDC.DESKTOP_HANDOFF_TIMEOUT) {
      try {
        const response = await fetch(pollUrl, {
          cache: 'no-store',
          credentials: 'include',
        });

        const data = await response.json().catch(() => undefined);

        console.log('[MarketOIDC] Poll response:', response.status, data);

        if (
          response.status === 200 &&
          data?.status === 'success' &&
          typeof data?.code === 'string'
        ) {
          console.log('[MarketOIDC] Desktop handoff succeeded');
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
