import { pathExistsSync } from 'fs-extra';
import { extname, join } from 'node:path';

import { nextExportDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';

import { RendererProtocolManager } from './RendererProtocolManager';

const logger = createLogger('core:RendererUrlManager');
const devDefaultRendererUrl = 'http://localhost:3015';

export class RendererUrlManager {
  private readonly rendererProtocolManager: RendererProtocolManager;
  private readonly rendererStaticOverride = getDesktopEnv().DESKTOP_RENDERER_STATIC;
  private rendererLoadedUrl: string;

  constructor() {
    this.rendererProtocolManager = new RendererProtocolManager({
      nextExportDir,
      resolveRendererFilePath: this.resolveRendererFilePath,
    });

    this.rendererLoadedUrl = this.rendererProtocolManager.getRendererUrl();
  }

  get protocolScheme() {
    return this.rendererProtocolManager.protocolScheme;
  }

  /**
   * Configure renderer loading strategy for dev/prod
   */
  configureRendererLoader() {
    if (isDev && !this.rendererStaticOverride) {
      this.rendererLoadedUrl = devDefaultRendererUrl;
      this.setupDevRenderer();
      return;
    }

    if (isDev && this.rendererStaticOverride) {
      logger.warn('Dev mode: DESKTOP_RENDERER_STATIC enabled, using static renderer handler');
    }

    this.setupProdRenderer();
  }

  /**
   * Build renderer URL for dev/prod.
   */
  buildRendererUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.rendererLoadedUrl}${cleanPath}`;
  }

  /**
   * Resolve renderer file path in production.
   * Static assets map directly; app routes fall back to index.html.
   */
  resolveRendererFilePath = async (url: URL): Promise<string | null> => {
    const pathname = url.pathname;
    const normalizedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    // Static assets should be resolved from root
    if (
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/static/') ||
      pathname === '/favicon.ico' ||
      pathname === '/manifest.json'
    ) {
      return this.resolveExportFilePath(pathname);
    }

    // If the incoming path already contains an extension (like .html or .ico),
    // treat it as a direct asset lookup.
    const extension = extname(normalizedPathname);
    if (extension) {
      return this.resolveExportFilePath(pathname);
    }

    return this.resolveExportFilePath('/');
  };

  private resolveExportFilePath(pathname: string) {
    // Normalize by removing leading/trailing slashes so extname works as expected
    const normalizedPath = decodeURIComponent(pathname).replace(/^\/+/, '').replace(/\/$/, '');

    if (!normalizedPath) return join(nextExportDir, 'index.html');

    const basePath = join(nextExportDir, normalizedPath);
    const ext = extname(normalizedPath);

    // If the request explicitly includes an extension (e.g. html, ico, txt),
    // treat it as a direct asset.
    if (ext) {
      return pathExistsSync(basePath) ? basePath : null;
    }

    const candidates = [`${basePath}.html`, join(basePath, 'index.html'), basePath];

    for (const candidate of candidates) {
      if (pathExistsSync(candidate)) return candidate;
    }

    const fallback404 = join(nextExportDir, '404.html');
    if (pathExistsSync(fallback404)) return fallback404;

    return null;
  }

  /**
   * Development: use Next dev server directly
   */
  private setupDevRenderer() {
    logger.info('Development mode: renderer served from Next dev server, no protocol hook');
  }

  /**
   * Production: serve static Next export assets
   */
  private setupProdRenderer() {
    this.rendererLoadedUrl = this.rendererProtocolManager.getRendererUrl();
    this.rendererProtocolManager.registerHandler();
  }
}
