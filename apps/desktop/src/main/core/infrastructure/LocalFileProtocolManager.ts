import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { app, protocol } from 'electron';

import { LOCAL_FILE_PROTOCOL_HOST, LOCAL_FILE_PROTOCOL_SCHEME } from '@/const/protocol';
import { createLogger } from '@/utils/logger';

import { getExportMimeType } from '../../utils/mime';

const LOCAL_FILE_PROTOCOL_PRIVILEGES = {
  allowServiceWorkers: false,
  bypassCSP: false,
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const;

const logger = createLogger('core:LocalFileProtocolManager');

const EXTRA_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const getMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return getExportMimeType(filePath) ?? EXTRA_MIME_TYPES[ext] ?? 'application/octet-stream';
};

/**
 * Custom `localfile://` protocol that serves arbitrary local files to the
 * Electron renderer (e.g. previews for the project Files tree).
 *
 * URL shape: `localfile://file/<percent-encoded-absolute-path>`
 *   - host is fixed to `file` so the scheme behaves as `standard`
 *   - the absolute path is encoded in the URL pathname
 *
 * Examples:
 *   localfile://file//Users/alice/Pictures/cat.png
 *   localfile://file/C:/Users/alice/Pictures/cat.png
 */
export class LocalFileProtocolManager {
  private handlerRegistered = false;

  get protocolScheme() {
    return {
      privileges: LOCAL_FILE_PROTOCOL_PRIVILEGES,
      scheme: LOCAL_FILE_PROTOCOL_SCHEME,
    };
  }

  registerHandler() {
    if (this.handlerRegistered) return;

    const register = () => {
      if (this.handlerRegistered) return;

      protocol.handle(LOCAL_FILE_PROTOCOL_SCHEME, async (request) => {
        try {
          const url = new URL(request.url);

          if (url.hostname !== LOCAL_FILE_PROTOCOL_HOST) {
            return new Response('Not Found', { status: 404 });
          }

          const resolvedPath = this.resolveFilePath(url.pathname);
          if (!resolvedPath) {
            return new Response('Invalid path', { status: 400 });
          }

          const fileStat = await stat(resolvedPath);
          if (!fileStat.isFile()) {
            return new Response('Not a file', { status: 404 });
          }

          const buffer = await readFile(resolvedPath);
          const headers = new Headers();
          headers.set('Content-Type', getMimeType(resolvedPath));
          headers.set('Content-Length', String(buffer.byteLength));
          // Local files are immutable from the renderer's perspective for a
          // single preview session; allow short-lived caching to avoid
          // re-reading large images during scrolling/refresh.
          headers.set('Cache-Control', 'private, max-age=60');

          return new Response(buffer, { headers, status: 200 });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            return new Response('Not Found', { status: 404 });
          }
          if (code === 'EACCES' || code === 'EPERM') {
            return new Response('Forbidden', { status: 403 });
          }
          logger.error(`Failed to serve localfile request ${request.url}:`, error);
          return new Response('Internal Server Error', { status: 500 });
        }
      });

      this.handlerRegistered = true;
      logger.debug(`Registered ${LOCAL_FILE_PROTOCOL_SCHEME}:// handler`);
    };

    if (app.isReady()) {
      register();
    } else {
      app.whenReady().then(register);
    }
  }

  /**
   * Decode the URL pathname back into an absolute filesystem path.
   *
   * Pathname examples produced by `new URL('localfile://file//abs/path')`:
   *   posix:    `//abs/path`           -> `/abs/path`
   *   windows:  `/C:/abs/path`         -> `C:/abs/path`
   *
   * Returns null when the path is non-absolute or escapes via segments we
   * cannot safely normalize (defense-in-depth, not a sandbox).
   */
  private resolveFilePath(pathname: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }

    // Strip the single leading slash inserted by URL parsing on standard
    // schemes; what remains should already be an absolute filesystem path.
    let candidate = decoded.startsWith('/') ? decoded.slice(1) : decoded;
    if (!candidate) return null;

    if (process.platform === 'win32') {
      // posix-style absolute path won't have a drive letter; treat as invalid
      // on Windows.
      candidate = candidate.replaceAll('/', '\\');
    } else if (!candidate.startsWith('/')) {
      // We expect an absolute POSIX path: `localfile://file//abs/path` yields
      // pathname `//abs/path` -> after stripping one slash -> `/abs/path`.
      candidate = `/${candidate}`;
    }

    const normalized = path.normalize(candidate);
    if (!path.isAbsolute(normalized)) return null;

    return normalized;
  }
}
