import { extname, join } from 'node:path';

import { pathExistsSync } from 'fs-extra';

import { rendererDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';

import { RendererProtocolManager } from './RendererProtocolManager';

const logger = createLogger('core:RendererUrlManager');

// Vite build with root=monorepo preserves input path structure,
// so index.html ends up at apps/desktop/index.html in outDir.
const SPA_ENTRY_HTML = join(rendererDir, 'apps', 'desktop', 'index.html');

export class RendererUrlManager {
  private readonly rendererProtocolManager: RendererProtocolManager;
  private readonly rendererStaticOverride = getDesktopEnv().DESKTOP_RENDERER_STATIC;
  private rendererLoadedUrl: string;

  constructor() {
    this.rendererProtocolManager = new RendererProtocolManager({
      rendererDir,
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
    const electronRendererUrl = process.env['ELECTRON_RENDERER_URL'];

    if (isDev && !this.rendererStaticOverride && electronRendererUrl) {
      this.rendererLoadedUrl = electronRendererUrl;
      this.setupDevRenderer();
      return;
    }

    if (isDev && !this.rendererStaticOverride && !electronRendererUrl) {
      logger.warn('Dev mode: ELECTRON_RENDERER_URL not set, falling back to protocol handler');
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
   * Static assets map directly; all routes fall back to index.html (SPA).
   */
  resolveRendererFilePath = async (url: URL): Promise<string | null> => {
    const pathname = url.pathname;

    // Static assets: direct file mapping
    if (pathname.startsWith('/assets/') || extname(pathname)) {
      const filePath = join(rendererDir, pathname);
      return pathExistsSync(filePath) ? filePath : null;
    }

    // All routes fallback to index.html (SPA)
    return SPA_ENTRY_HTML;
  };

  /**
   * Development: use electron-vite renderer dev server
   */
  private setupDevRenderer() {
    logger.info(
      `Development mode: renderer served from electron-vite dev server at ${this.rendererLoadedUrl}`,
    );
  }

  /**
   * Production: serve static renderer assets via protocol handler
   */
  private setupProdRenderer() {
    this.rendererLoadedUrl = this.rendererProtocolManager.getRendererUrl();
    this.rendererProtocolManager.registerHandler();
  }
}
