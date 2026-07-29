import { AUTH_REQUIRED_HEADER } from '@lobechat/desktop-bridge';
import { BrowserWindow, type Session, session as electronSession } from 'electron';

import { isDev } from '@/const/env';
import { isBackendPath } from '@/const/protocol';
import { getDesktopEnv } from '@/env';
import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';
import { classifyProxyNetworkError } from '@/utils/proxy-network-error';
import { setDesktopUserAgentHeader } from '@/utils/user-agent';

import type { RendererRequestInterceptor } from './RendererProtocolManager';

interface BackendProxyContext {
  getAccessToken: () => Promise<string | undefined | null>;
  rewriteUrl: (rawUrl: string) => Promise<string | null>;
  source?: string;
}

interface BackendProxyRemoteBaseOptions {
  getAccessToken: () => Promise<string | undefined | null>;
  getRemoteBaseUrl: () => Promise<string | undefined | null>;
  source?: string;
}

/**
 * Holds per-session proxy context for routing renderer-originated backend
 * requests (`/trpc`, `/webapi`, `/api/auth`, `/market`) to the remote LobeHub
 * server. The context is consumed by `createAppRequestInterceptor`, which the
 * `app://` protocol manager invokes before its static / Vite fallback.
 */
const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
};

/**
 * Serialize a network-level proxy failure as the JSON `ErrorResponse` envelope
 * (`{ body, errorType }`) the renderer's error chain already parses — a plain
 * 502 is indistinguishable from a real server-side 502, and users read that as
 * an app bug when it is almost always their own network/proxy/VPN.
 */
const proxyNetworkErrorBody = (reason: string, url?: string) =>
  JSON.stringify({
    body: { detail: reason, ...(url ? { url } : {}) },
    errorType: classifyProxyNetworkError(reason),
  });

export class BackendProxyProtocolManager {
  private readonly contexts = new WeakMap<Session, BackendProxyContext>();
  private readonly logger = createLogger('core:BackendProxyProtocolManager');

  private authRequiredDebounceTimer: NodeJS.Timeout | null = null;
  private pendingAuthRequiredReason: string | null = null;
  private surfacedUncaughtProxyError = false;
  private static readonly AUTH_REQUIRED_DEBOUNCE_MS = 1000;

  /** Upstream requests awaiting response headers. */
  private pendingUpstream = 0;
  /**
   * Upstream responses whose body is still streaming. Each one holds a socket
   * in the default session's pool, and `net.fetch` inside `protocol.handle` is
   * downgraded to HTTP/1.1 (electron#46828) — so the pool caps out at 6 per
   * host. A body that never closes never gives its socket back, which is what a
   * "every backend call 502s until restart" failure looks like from the outside.
   */
  private openUpstreamBodies = 0;

  /**
   * Wrap an upstream body so the gauge drops when the stream ends — whether it
   * completes, errors, or the renderer cancels it.
   */
  private trackUpstreamBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    this.openUpstreamBodies += 1;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.openUpstreamBodies -= 1;
    };

    return new ReadableStream<Uint8Array>({
      cancel: (reason) => {
        release();
        return reader.cancel(reason);
      },
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          release();
          controller.error(error);
        }
      },
    });
  }

  private shouldRethrowProxyErrors() {
    return isDev && getDesktopEnv().DESKTOP_BACKEND_PROXY_RETHROW_ERRORS;
  }

  private surfaceUncaughtProxyError(error: unknown) {
    if (!this.shouldRethrowProxyErrors() || this.surfacedUncaughtProxyError) return;

    this.surfacedUncaughtProxyError = true;
    setTimeout(() => {
      throw error;
    }, 0);
  }

  private notifyAuthorizationRequired(reason: string) {
    // Trailing-edge debounce: coalesce rapid 401 bursts and fire AFTER the burst settles.
    // This ensures the IPC event is sent after the renderer has had time to mount listeners.
    // The most recent reason wins — within a burst they almost always describe the same cause.
    this.pendingAuthRequiredReason = reason;

    if (this.authRequiredDebounceTimer) {
      clearTimeout(this.authRequiredDebounceTimer);
    }

    this.authRequiredDebounceTimer = setTimeout(() => {
      this.authRequiredDebounceTimer = null;
      const finalReason = this.pendingAuthRequiredReason ?? reason;
      this.pendingAuthRequiredReason = null;

      this.logger.info(`Broadcasting authorizationRequired (reason=${finalReason})`);

      const allWindows = BrowserWindow.getAllWindows();
      for (const win of allWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send('authorizationRequired', { reason: finalReason });
        }
      }
    }, BackendProxyProtocolManager.AUTH_REQUIRED_DEBOUNCE_MS);
  }

  /**
   * Bind a session's proxy context using a remote-base-URL provider. Backend
   * paths get rewritten onto the remote base; same-origin requests pass through
   * (returns null so the `app://` handler falls back to its static / Vite path).
   */
  registerWithRemoteBaseUrl(session: Session, options: BackendProxyRemoteBaseOptions) {
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
      source: options.source,
    });
  }

  /**
   * Bind a session's proxy context. Subsequent backend-path requests on this
   * session will be rewritten via `rewriteUrl` and have `Oidc-Auth` injected.
   */
  register(session: Session, context: BackendProxyContext) {
    if (!session) return;
    this.contexts.set(session, context);
  }

  /**
   * Build an `app://` request interceptor that diverts backend-prefixed paths
   * (trpc / webapi / api/auth / market) through `proxy()` against the default
   * session. Plug into `RendererProtocolManager.addRequestInterceptor` so the
   * protocol manager doesn't need to know what "backend" means.
   *
   * Returns `null` for non-backend paths (lets the fallback run). Returns a
   * 502 if the backend context isn't wired up yet — for backend prefixes we
   * must never fall through to the SPA HTML / Vite path.
   */
  createAppRequestInterceptor(): RendererRequestInterceptor {
    return async (request) => {
      const url = new URL(request.url);
      if (!isBackendPath(url.pathname)) return null;

      const session = electronSession.defaultSession;
      if (!session)
        return new Response('Backend Proxy Unavailable: no default session', { status: 502 });

      try {
        const proxied = await this.proxy(request, session);
        // No context bound yet, or no remote base URL resolved — distinct from an
        // upstream network failure, so say which one it was.
        return (
          proxied ??
          new Response('Backend Proxy Unavailable: no proxy context for this session', {
            status: 502,
          })
        );
      } catch (error) {
        const reason = describeError(error);
        this.logger.error(`BackendProxy interceptor failed (${reason}): ${request.url}`, error);
        this.surfaceUncaughtProxyError(error);

        return new Response(proxyNetworkErrorBody(reason), {
          headers: new Headers({
            'Content-Type': 'application/json',
            'X-Proxy-Error': reason,
          }),
          status: 502,
        });
      }
    };
  }

  /**
   * Proxy a renderer-originated request through the remote LobeHub backend.
   * Returns `null` if the session has no proxy context registered yet (caller
   * decides how to fall back). Upstream network failures become a controlled
   * 502 response so they do not escape Electron's `protocol.handle` callback.
   */
  async proxy(request: Request, session: Session): Promise<Response | null> {
    const context = this.contexts.get(session);
    if (!context) return null;

    const logPrefix = context.source ? `[${context.source}] BackendProxy` : '[BackendProxy]';

    const rewrittenUrl = await context.rewriteUrl(request.url);
    if (!rewrittenUrl) return null;

    const headers = new Headers(request.headers);
    const token = await context.getAccessToken();
    if (token) {
      headers.set('Oidc-Auth', token);
    }
    appendVercelCookie(headers);
    setDesktopUserAgentHeader(headers);

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
    this.pendingUpstream += 1;
    try {
      upstreamResponse = await netFetch(rewrittenUrl, requestInit);
    } catch (error) {
      // Drop this request from the gauge before snapshotting it: it has already
      // settled (in failure), so counting it would report `pendingUpstream=1` for
      // a lone failure with nothing else in flight — an inflation that reads like
      // the very backlog the gauge exists to detect.
      this.pendingUpstream -= 1;

      // The Chromium error (net::ERR_*) is the whole diagnosis — carry it into
      // the log, the body, and a header so it is readable from DevTools without
      // a debug build.
      const reason = describeError(error);
      const gauges = `pendingUpstream=${this.pendingUpstream}, openUpstreamBodies=${this.openUpstreamBodies}`;
      this.logger.error(
        `${logPrefix} upstream fetch failed (${reason}) [${gauges}]: ${rewrittenUrl}`,
        error,
      );
      this.surfaceUncaughtProxyError(error);

      const responseHeaders = new Headers({
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': '*',
        'Content-Type': 'application/json',
        'X-Proxy-Error': reason,
        'X-Proxy-Open-Upstream-Bodies': String(this.openUpstreamBodies),
        'X-Proxy-Pending-Upstream': String(this.pendingUpstream),
        'X-Src-Url': rewrittenUrl,
      });
      const allowOrigin = request.headers.get('Origin') || undefined;
      if (allowOrigin) {
        responseHeaders.set('Access-Control-Allow-Origin', allowOrigin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      }
      return new Response(proxyNetworkErrorBody(reason, rewrittenUrl), {
        headers: responseHeaders,
        status: 502,
        statusText: 'Bad Gateway',
      });
    }
    // Headers are in: this request is no longer *pending*. The failure path above
    // already decremented, so this must not run in a `finally` (that would double
    // count and drive the gauge negative).
    this.pendingUpstream -= 1;

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

    // Re-auth prompt: rely on X-Auth-Required (set by tRPC responseMeta for UNAUTHORIZED).
    // Batched tRPC responses can use HTTP 207 when calls mix success (200) and UNAUTHORIZED (401);
    // checking only status === 401 misses that case and the login modal never opens.
    // Other failures keep 401 without this header (e.g., invalid API keys) and must not notify here.
    const authRequired = upstreamResponse.headers.get(AUTH_REQUIRED_HEADER) === 'true';
    if (authRequired) {
      const pathTag = (() => {
        try {
          return new URL(rewrittenUrl).pathname;
        } catch {
          return rewrittenUrl;
        }
      })();
      const sourceTag = context.source ? `${context.source}:` : '';
      const wwwAuth = upstreamResponse.headers.get('www-authenticate') ?? '';
      // Clone before forwarding the body downstream — the original stream stays
      // intact for the renderer. Body snippet is truncated to keep logs small
      // and to avoid leaking large payloads if the server ever returns one.
      let bodySnippet: string;
      try {
        bodySnippet = (await upstreamResponse.clone().text()).slice(0, 300).replaceAll(/\s+/g, ' ');
      } catch (error) {
        bodySnippet = `<body-read-failed:${error instanceof Error ? error.message : 'unknown'}>`;
      }
      const parts = [
        `proxy:${sourceTag}status=${upstreamResponse.status}`,
        `${request.method} ${pathTag}`,
        `hadToken=${Boolean(token)}`,
      ];
      if (wwwAuth) parts.push(`wwwAuth=${wwwAuth}`);
      if (bodySnippet) parts.push(`body=${bodySnippet}`);
      this.notifyAuthorizationRequired(parts.join(' '));
    }

    return new Response(
      upstreamResponse.body ? this.trackUpstreamBody(upstreamResponse.body) : null,
      {
        headers: responseHeaders,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
      },
    );
  }
}

export const backendProxyProtocolManager = new BackendProxyProtocolManager();
