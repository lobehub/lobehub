import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { app, protocol } from 'electron';
import { pathExistsSync } from 'fs-extra';

import { createLogger } from '@/utils/logger';

import { getExportMimeType } from '../../utils/mime';

type ResolveRendererFilePath = (url: URL) => Promise<string | null>;

/**
 * Request interceptor: inspects an `app://` request and either produces a Response
 * (short-circuits the pipeline) or returns `null` to let the next interceptor — and
 * ultimately the fallback strategy — try.
 */
export type RendererRequestInterceptor = (request: Request) => Promise<Response | null>;

/**
 * Fallback strategy invoked when no interceptor handled the request. Static
 * (production) and Vite-proxy (development) implementations live below; the
 * protocol manager is agnostic to which one is plugged in.
 */
export interface RendererFallbackStrategy {
  handle: (request: Request, url: URL) => Promise<Response>;
}

const RENDERER_PROTOCOL_PRIVILEGES = {
  allowServiceWorkers: true,
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const;

interface RendererProtocolManagerOptions {
  fallback: RendererFallbackStrategy;
  host?: string;
  scheme?: string;
}

const RENDERER_DIR = 'renderer';

export class RendererProtocolManager {
  private readonly scheme: string;
  private readonly host: string;
  private readonly fallback: RendererFallbackStrategy;
  private readonly interceptors: RendererRequestInterceptor[] = [];
  private handlerRegistered = false;

  constructor(options: RendererProtocolManagerOptions) {
    this.scheme = options.scheme ?? 'app';
    this.host = options.host ?? RENDERER_DIR;
    this.fallback = options.fallback;
  }

  /**
   * Register a request interceptor that runs before the fallback strategy.
   * Interceptors are invoked in registration order; the first one to return a
   * non-null Response short-circuits the pipeline.
   */
  addRequestInterceptor(interceptor: RendererRequestInterceptor) {
    this.interceptors.push(interceptor);
  }

  getRendererUrl(): string {
    return `${this.scheme}://${this.host}`;
  }

  get protocolScheme() {
    return {
      privileges: RENDERER_PROTOCOL_PRIVILEGES,
      scheme: this.scheme,
    };
  }

  registerHandler() {
    if (this.handlerRegistered) return;

    const logger = createLogger('core:RendererProtocolManager');
    logger.debug(`Registering ${this.scheme}:// handler for host ${this.host}`);

    const register = () => {
      if (this.handlerRegistered) return;

      protocol.handle(this.scheme, async (request) => {
        const url = new URL(request.url);

        if (url.hostname !== this.host) {
          return new Response('Not Found', { status: 404 });
        }

        // Pipeline: first interceptor to return a Response wins; null = pass through.
        for (const interceptor of this.interceptors) {
          const response = await interceptor(request);
          if (response) return response;
        }

        return this.fallback.handle(request, url);
      });

      this.handlerRegistered = true;
    };

    if (app.isReady()) {
      register();
    } else {
      // protocol.handle needs the default session, which is only available after ready
      app.whenReady().then(register);
    }
  }
}

/**
 * Production fallback: serve the renderer's static export from disk. Resolves
 * the file via `resolveRendererFilePath`, falls back to the SPA entry HTML for
 * unknown routes, and supports HTTP `Range` requests for media playback.
 */
export class StaticRendererFallback implements RendererFallbackStrategy {
  private readonly rendererDir: string;
  private readonly resolveRendererFilePath: ResolveRendererFilePath;
  private readonly logger = createLogger('core:StaticRendererFallback');

  constructor(rendererDir: string, resolveRendererFilePath: ResolveRendererFilePath) {
    this.rendererDir = rendererDir;
    this.resolveRendererFilePath = resolveRendererFilePath;

    if (!pathExistsSync(this.rendererDir)) {
      this.logger.warn(`Renderer directory not found: ${this.rendererDir}`);
    }
  }

  async handle(request: Request, url: URL): Promise<Response> {
    const pathname = url.pathname;
    const isAssetRequest = this.isAssetRequest(pathname);
    const isExplicit404HtmlRequest = pathname.endsWith('/404.html');

    let filePath = await this.resolveRendererFilePath(url);

    if (filePath && this.is404Html(filePath) && !isExplicit404HtmlRequest) {
      filePath = null;
    }

    if (!filePath) {
      if (isAssetRequest) {
        return new Response('File Not Found', { status: 404 });
      }

      filePath = await this.resolveEntryFilePath(url);
      if (!filePath || this.is404Html(filePath)) {
        return new Response('Render file Not Found', { status: 404 });
      }
    }

    try {
      return await this.buildFileResponse(request, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT') {
        this.logger.warn(`Export asset missing on disk ${filePath}, falling back`, error);

        if (isAssetRequest) {
          return new Response('File Not Found', { status: 404 });
        }

        const fallbackPath = await this.resolveEntryFilePath(url);
        if (!fallbackPath || this.is404Html(fallbackPath)) {
          return new Response('Render file Not Found', { status: 404 });
        }

        try {
          return await this.buildFileResponse(request, fallbackPath);
        } catch (fallbackError) {
          this.logger.error(`Failed to serve fallback entry ${fallbackPath}:`, fallbackError);
          return new Response('Internal Server Error', { status: 500 });
        }
      }

      this.logger.error(`Failed to serve export asset ${filePath}:`, error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private resolveEntryFilePath(url: URL) {
    return this.resolveRendererFilePath(new URL(`${url.protocol}//${url.host}/`));
  }

  private async buildFileResponse(request: Request, targetPath: string): Promise<Response> {
    const fileStat = await stat(targetPath);
    const totalSize = fileStat.size;

    const buffer = await readFile(targetPath);
    const headers = new Headers();
    const mimeType = getExportMimeType(targetPath);

    if (mimeType) headers.set('Content-Type', mimeType);

    // Chromium media pipeline relies on byte ranges for video/audio.
    headers.set('Accept-Ranges', 'bytes');

    const method = request.method?.toUpperCase?.() || 'GET';
    const rangeHeader = request.headers.get('range') || request.headers.get('Range');

    if (method === 'HEAD' && !rangeHeader) {
      headers.set('Content-Length', String(totalSize));
      return new Response(null, { headers, status: 200 });
    }

    if (!rangeHeader) {
      headers.set('Content-Length', String(buffer.byteLength));
      return new Response(buffer, { headers, status: 200 });
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
      headers.set('Content-Range', `bytes */${totalSize}`);
      return new Response(null, {
        headers,
        status: 416,
        statusText: 'Range Not Satisfiable',
      });
    }

    const [, startRaw, endRaw] = match;
    let start = startRaw ? Number(startRaw) : Number.NaN;
    let end = endRaw ? Number(endRaw) : Number.NaN;

    // Suffix range: bytes=-N (last N bytes)
    if (!startRaw && endRaw) {
      const suffixLength = Number(endRaw);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        headers.set('Content-Range', `bytes */${totalSize}`);
        return new Response(null, {
          headers,
          status: 416,
          statusText: 'Range Not Satisfiable',
        });
      }
      start = Math.max(totalSize - suffixLength, 0);
      end = totalSize - 1;
    } else {
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = totalSize - 1;
    }

    if (start < 0 || end < 0 || start > end || start >= totalSize) {
      headers.set('Content-Range', `bytes */${totalSize}`);
      return new Response(null, {
        headers,
        status: 416,
        statusText: 'Range Not Satisfiable',
      });
    }

    end = Math.min(end, totalSize - 1);
    const sliced = buffer.subarray(start, end + 1);

    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(sliced.byteLength));

    if (method === 'HEAD') {
      return new Response(null, { headers, status: 206, statusText: 'Partial Content' });
    }

    return new Response(sliced, { headers, status: 206, statusText: 'Partial Content' });
  }

  private isAssetRequest(pathname: string) {
    const normalizedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const ext = path.extname(normalizedPathname);

    return (
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/static/') ||
      pathname === '/favicon.ico' ||
      pathname === '/manifest.json' ||
      !!ext
    );
  }

  private is404Html(filePath: string) {
    return path.basename(filePath) === '404.html';
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

const VITE_FETCH_CONCURRENCY = 64;

export class ViteRendererFallback implements RendererFallbackStrategy {
  private readonly viteOrigin: string;
  private readonly logger = createLogger('core:ViteRendererFallback');
  private readonly gate = new Semaphore(VITE_FETCH_CONCURRENCY);

  constructor(viteOrigin: string) {
    this.viteOrigin = viteOrigin.replace(/\/+$/, '');
  }

  async handle(request: Request, url: URL): Promise<Response> {
    const target = `${this.viteOrigin}${url.pathname}${url.search}`;

    // Strip Host so fetch derives it from the target URL (otherwise Vite
    // sees `Host: renderer` and middleware that keys off Host can misbehave).
    const headers = new Headers(request.headers);
    headers.delete('host');

    const init: RequestInit & { duplex?: 'half' } = {
      headers,
      method: request.method,
    };

    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
      init.body = request.body;
      init.duplex = 'half';
    }

    const release = await this.gate.acquire();
    try {
      const response = await fetch(target, init);
      return this.releaseOnBodyDone(response, release);
    } catch (error) {
      release();
      this.logger.error(`Vite dev server fetch failed: ${target}`, error);
      return new Response('Vite Dev Server Unavailable', { status: 502 });
    }
  }

  private releaseOnBodyDone(response: Response, release: () => void): Response {
    if (!response.body) {
      release();
      return response;
    }

    const passthrough = new TransformStream();
    void response.body.pipeTo(passthrough.writable).then(release, release);

    return new Response(passthrough.readable, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}
