import path from 'node:path';

import { pathExistsSync } from 'fs-extra';

import { rendererDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';

import {
  RendererProtocolManager,
  type RendererRequestInterceptor,
  StaticRendererFallback,
  ViteRendererFallback,
} from './RendererProtocolManager';

const logger = createLogger('core:RendererUrlManager');

// Vite build with root=monorepo preserves input path structure,
// so index.html / overlay.html / popup.html end up under apps/desktop/ in outDir.
const SPA_ENTRY_HTML = path.join(rendererDir, 'apps', 'desktop', 'index.html');
const OVERLAY_ENTRY_HTML = path.join(rendererDir, 'apps', 'desktop', 'overlay.html');
const POPUP_ENTRY_HTML = path.join(rendererDir, 'apps', 'desktop', 'popup.html');

export class RendererUrlManager {
  private readonly rendererProtocolManager: RendererProtocolManager;
  private readonly rendererStaticOverride = getDesktopEnv().DESKTOP_RENDERER_STATIC;
  private readonly rendererLoadedUrl: string;

  constructor() {
    this.rendererProtocolManager = new RendererProtocolManager({
      fallback: this.pickFallback(),
    });

    this.rendererLoadedUrl = this.rendererProtocolManager.getRendererUrl();
  }

  get protocolScheme() {
    return this.rendererProtocolManager.protocolScheme;
  }

  addRequestInterceptor(interceptor: RendererRequestInterceptor) {
    this.rendererProtocolManager.addRequestInterceptor(interceptor);
  }

  /**
   * Register the `app://` protocol handler. Idempotent — safe to call after
   * interceptors are wired.
   */
  configureRendererLoader() {
    this.rendererProtocolManager.registerHandler();
  }

  /**
   * Build a renderer URL. Always uses `app://renderer` so dev and prod share
   * the same origin (cookies, storage, service-workers). Dev requests are
   * proxied to the Vite dev server inside the `app://` handler.
   */
  buildRendererUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const normalizedBase = this.rendererLoadedUrl.replace(/\/+$/, '');

    return `${normalizedBase}${cleanPath}`;
  }

  /**
   * Resolve a renderer file path against the static export. Used by the
   * production fallback; left on the manager so the desktop-specific entry
   * HTML mappings stay in one place.
   *
   * Static assets map directly; /overlay routes fall back to overlay.html;
   * popup routes go to popup.html; all other routes fall back to index.html (SPA).
   */
  resolveRendererFilePath = async (url: URL): Promise<string | null> => {
    const pathname = url.pathname;

    // Static assets: direct file mapping
    if (pathname.startsWith('/assets/') || path.extname(pathname)) {
      const filePath = path.join(rendererDir, pathname);
      return pathExistsSync(filePath) ? filePath : null;
    }

    // Overlay entry (separate MPA page)
    if (pathname === '/overlay' || pathname === '/overlay.html') {
      return OVERLAY_ENTRY_HTML;
    }

    // Topic popup window has its own SPA bundle.
    if (pathname === '/popup' || pathname.startsWith('/popup/')) {
      return POPUP_ENTRY_HTML;
    }

    // All other routes fallback to index.html (SPA)
    return SPA_ENTRY_HTML;
  };

  private pickFallback() {
    const electronRendererUrl = process.env['ELECTRON_RENDERER_URL'];

    if (isDev && !this.rendererStaticOverride && electronRendererUrl) {
      logger.info(
        `Development mode: app:// requests proxied to Vite dev server at ${electronRendererUrl}`,
      );
      return new ViteRendererFallback(electronRendererUrl);
    }

    if (isDev && !this.rendererStaticOverride && !electronRendererUrl) {
      logger.warn(
        'Dev mode: ELECTRON_RENDERER_URL not set, falling back to static renderer handler',
      );
    }

    if (isDev && this.rendererStaticOverride) {
      logger.warn('Dev mode: DESKTOP_RENDERER_STATIC enabled, using static renderer handler');
    }

    return new StaticRendererFallback(rendererDir, this.resolveRendererFilePath);
  }
}
