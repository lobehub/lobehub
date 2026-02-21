import { AUTH_REQUIRED_HEADER } from '@lobechat/desktop-bridge';
import { BrowserWindow, type Session } from 'electron';

import { isDev } from '@/const/env';
import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';

interface BackendProxyProtocolManagerOptions {
  getAccessToken: () => Promise<string | undefined | null>;
  rewriteUrl: (rawUrl: string) => Promise<string | null>;
  scheme: string;
  /**
   * Used for log prefixes. e.g. window identifier
   */
  source?: string;
}

interface BackendProxyProtocolManagerRemoteBaseOptions {
  getAccessToken: () => Promise<string | undefined | null>;
  getRemoteBaseUrl: () => Promise<string | undefined | null>;
  scheme: string;
  /**
   * Used for log prefixes. e.g. window identifier
   */
  source?: string;
}

/**
 * Manage `lobe-backend://` (or any custom scheme) transparent proxy handler registration.
 * Keeps a WeakSet per session to avoid duplicate handler registration.
 */
export class BackendProxyProtocolManager {
  private readonly handledSessions = new WeakSet<Session>();
  private readonly logger = createLogger('core:BackendProxyProtocolManager');

  /**
   * Debounce timer for authorization required notifications.
   * Prevents multiple rapid 401 responses from triggering duplicate notifications.
   */
  // eslint-disable-next-line no-undef
  private authRequiredDebounceTimer: NodeJS.Timeout | null = null;
  private static readonly AUTH_REQUIRED_DEBOUNCE_MS = 1000;

  private notifyAuthorizationRequired() {
    // Debounce: skip if a notification is already scheduled
    if (this.authRequiredDebounceTimer) {
      return;
    }

    this.authRequiredDebounceTimer = setTimeout(() => {
      this.authRequiredDebounceTimer = null;
    }, BackendProxyProtocolManager.AUTH_REQUIRED_DEBOUNCE_MS);

    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('authorizationRequired');
      }
    }
  }

  registerWithRemoteBaseUrl(
    session: Session,
    options: BackendProxyProtocolManagerRemoteBaseOptions,
  ) {
    let lastRemoteBaseUrl: string | undefined;

    const rewriteUrl = async (rawUrl: string) => {
      lastRemoteBaseUrl = undefined;
      try {
        const requestUrl = new URL(rawUrl);

        const remoteBaseUrl = await options.getRemoteBaseUrl();
        if (!remoteBaseUrl) return null;
        lastRemoteBaseUrl = remoteBaseUrl;

        const remoteBase = new URL(remoteBaseUrl);
        if (requestUrl.origin === remoteBase.origin) return null;

        const rewrittenUrl = new URL(
          requestUrl.pathname + requestUrl.search,
          remoteBase,
        ).toString();
        this.logger.debug(
          `${options.source ? `[${options.source}] ` : ''}BackendProxy rewrite ${rawUrl} -> ${rewrittenUrl}`,
        );
        return rewrittenUrl;
      } catch (error) {
        this.logger.error(
          `${options.source ? `[${options.source}] ` : ''}BackendProxy rewriteUrl error (rawUrl=${rawUrl}, remoteBaseUrl=${lastRemoteBaseUrl})`,
          error,
        );
        return null;
      }
    };

    this.register(session, {
      getAccessToken: options.getAccessToken,
      rewriteUrl,
      scheme: options.scheme,
      source: options.source,
    });
  }

  register(session: Session, options: BackendProxyProtocolManagerOptions) {
    if (!session || this.handledSessions.has(session)) return;

    const logPrefix = options.source ? `[${options.source}] BackendProxy` : '[BackendProxy]';

    session.protocol.handle(options.scheme, async (request: Request): Promise<Response | null> => {
      try {
        const rewrittenUrl = await options.rewriteUrl(request.url);
        if (!rewrittenUrl) return null;

        const headers = new Headers(request.headers);
        const token = await options.getAccessToken();
        if (token) {
          headers.set('Oidc-Auth', token);
        }
        appendVercelCookie(headers);

        // eslint-disable-next-line no-undef
        const requestInit: RequestInit & { duplex?: 'half' } = {
          headers,
          method: request.method,
        };

        // Only forward body for non-GET/HEAD requests
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const body = request.body ?? undefined;
          if (body) {
            requestInit.body = body;
            // Node.js (undici) requires `duplex` when sending a streaming body
            requestInit.duplex = 'half';
          }
        }

        let upstreamResponse: Response;
        try {
          upstreamResponse = await fetch(rewrittenUrl, requestInit);
        } catch (error) {
          this.logger.error(`${logPrefix} upstream fetch failed: ${rewrittenUrl}`, error);

          return new Response('Upstream fetch failed, target url: ' + rewrittenUrl, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
            },
            status: 502,
            statusText: 'Bad Gateway',
          });
        }

        const responseHeaders = new Headers(upstreamResponse.headers);
        const allowOrigin = request.headers.get('Origin') || undefined;

        if (allowOrigin) {
          responseHeaders.set('Access-Control-Allow-Origin', allowOrigin);
          responseHeaders.set('Access-Control-Allow-Credentials', 'true');
        }

        if (isDev) {
          responseHeaders.set('x-dev-oidc-auth', token);
        }

        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');
        responseHeaders.set('X-Src-Url', rewrittenUrl);

        // Handle 401 Unauthorized: only notify authorization required for real auth failures
        // The server sets X-Auth-Required header for real authentication failures (e.g., token expired)
        // Other 401 errors (e.g., invalid API keys) should not trigger re-authentication
        if (upstreamResponse.status === 401) {
          const authRequired = upstreamResponse.headers.get(AUTH_REQUIRED_HEADER) === 'true';
          if (authRequired) {
            this.notifyAuthorizationRequired();
          }
        }

        return new Response(upstreamResponse.body, {
          headers: responseHeaders,
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
        });
      } catch (error) {
        this.logger.error(`${logPrefix} protocol.handle error:`, error);
        return null;
      }
    });

    this.logger.debug(`${logPrefix} protocol handler registered for ${options.scheme}`);
    this.handledSessions.add(session);
  }
}

export const backendProxyProtocolManager = new BackendProxyProtocolManager();
