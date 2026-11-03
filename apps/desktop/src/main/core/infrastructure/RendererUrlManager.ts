import path from 'node:path';

import { app } from 'electron';

import { rendererDir } from '@/const/dir';
import { isDev } from '@/const/env';
import { type ShellGlobal, shellInfo } from '@/const/shell';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';

import { readBuiltinManifest } from './coreOta/manifest';
import {
  dirRendererSource,
  type RendererSource,
  treeRendererSource,
} from './coreOta/rendererSource';
import {
  type RendererFile,
  RendererProtocolManager,
  type RendererRequestInterceptor,
  StaticRendererFallback,
  ViteRendererFallback,
} from './RendererProtocolManager';

const logger = createLogger('core:RendererUrlManager');

// Vite build with root=monorepo preserves input path structure,
// so index.html / overlay.html / popup.html end up under apps/desktop/ in outDir.
const SPA_ENTRY_HTML = 'apps/desktop/index.html';
const OVERLAY_ENTRY_HTML = 'apps/desktop/overlay.html';
const POPUP_ENTRY_HTML = 'apps/desktop/popup.html';

// An external core ships no renderer files; its tree resolves against the builtin archive and
// the OTA object store.
const shellRendererSource = (shell: ShellGlobal | undefined = shellInfo): RendererSource => {
  if (shell?.source !== 'external' || !shell.manifest) return dirRendererSource(rendererDir);
  return treeRendererSource({
    builtinDir: shell.builtinDir,
    builtinTree: readBuiltinManifest(shell)?.tree ?? [],
    storeDir: path.join(app.getPath('userData'), 'core-ota', 'store'),
    tree: shell.manifest.tree,
  });
};

export class RendererUrlManager {
  private readonly rendererProtocolManager: RendererProtocolManager;
  private readonly rendererStaticOverride = getDesktopEnv().DESKTOP_RENDERER_STATIC;
  private readonly rendererLoadedUrl: string;
  private readonly runningRenderer = shellRendererSource();
  private activeRenderer = this.runningRenderer;
  private previousRenderer: RendererSource | null = null;

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
   * Point the static renderer at an OTA version (or back to the running core's
   * renderer with `null`). Only takes effect between window reloads — requests
   * read the field per resolution, no in-flight swap.
   */
  setActiveRenderer(source: RendererSource | null) {
    const next = source ?? this.runningRenderer;
    if (next !== this.runningRenderer && !next.resolve(SPA_ENTRY_HTML)) {
      logger.warn('OTA renderer missing entry html, falling back to the running renderer');
      this.activeRenderer = this.runningRenderer;
      return;
    }
    if (next !== this.activeRenderer) this.previousRenderer = this.activeRenderer;
    this.activeRenderer = next;
  }

  getActiveRenderer() {
    return this.activeRenderer;
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
  resolveRendererFilePath = async (url: URL): Promise<RendererFile | null> => {
    const pathname = url.pathname;

    // Static assets: direct file mapping
    if (pathname.startsWith('/assets/') || path.extname(pathname)) {
      const relPath = pathname.slice(1);
      // Windows that cancelled the OTA reload via beforeunload still lazy-load
      // hash-named chunks from the previous tree.
      const filePath =
        this.activeRenderer.resolve(relPath) ??
        (pathname.startsWith('/assets/') ? this.previousRenderer?.resolve(relPath) : null);
      return filePath ? { filePath, name: path.basename(pathname) } : null;
    }

    // Overlay entry (separate MPA page)
    if (pathname === '/overlay' || pathname === '/overlay.html') {
      return this.resolveEntry(OVERLAY_ENTRY_HTML);
    }

    // Topic popup window has its own SPA bundle.
    if (pathname === '/popup' || pathname.startsWith('/popup/')) {
      return this.resolveEntry(POPUP_ENTRY_HTML);
    }

    // All other routes fallback to index.html (SPA)
    return this.resolveEntry(SPA_ENTRY_HTML);
  };

  private resolveEntry(relPath: string): RendererFile | null {
    const filePath = this.activeRenderer.resolve(relPath);
    return filePath ? { filePath, name: path.basename(relPath) } : null;
  }

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

    return new StaticRendererFallback(this.resolveRendererFilePath);
  }
}
