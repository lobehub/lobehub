import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { app, protocol } from 'electron';

import { LOCAL_FILE_PROTOCOL_HOST, LOCAL_FILE_PROTOCOL_SCHEME } from '@/const/protocol';
import { createLogger } from '@/utils/logger';

import { resolveLocalFileMimeType } from '../../utils/mime';

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
const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;
const EXTERNAL_PREVIEW_APPROVAL_TTL_MS = 10 * 60 * 1000;

const normalizeAbsolutePath = (filePath: string): string | null => {
  const normalized = path.normalize(filePath);
  return path.isAbsolute(normalized) ? normalized : null;
};

const isPathWithinRoot = (targetPath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const buildLocalFileUrl = (absolutePath: string, token: string): string => {
  const forwardSlashed = absolutePath.replaceAll('\\', '/');
  const stripped = forwardSlashed.startsWith('/') ? forwardSlashed.slice(1) : forwardSlashed;
  const encoded = stripped.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`${LOCAL_FILE_PROTOCOL_SCHEME}://${LOCAL_FILE_PROTOCOL_HOST}/${encoded}`);
  url.searchParams.set('token', token);
  return url.toString();
};

interface PreviewTokenRecord {
  expiresAt: number;
  realPath: string;
}

export interface PreviewFileReadResult {
  buffer: Buffer;
  contentType: string;
  realPath: string;
}

type PreviewFileAccept = 'image';

const normalizeContentType = (contentType: string): string =>
  contentType.split(';')[0].trim().toLowerCase();

const isAcceptedPreviewContentType = (contentType: string, accept?: PreviewFileAccept): boolean => {
  if (!accept) return true;

  const normalizedContentType = normalizeContentType(contentType);
  return accept === 'image' && normalizedContentType.startsWith('image/');
};

/**
 * Custom `localfile://` protocol for project file previews.
 *
 * URL shape: `localfile://file/<percent-encoded-absolute-path>?token=<main-issued-token>`
 *   - host is fixed to `file` so the scheme behaves as `standard`
 *   - the absolute path is encoded in the URL pathname
 *   - every request must carry a short-lived token minted by the main process
 *
 * Examples:
 *   localfile://file//Users/alice/project/cat.png?token=...
 *   localfile://file/C:/Users/alice/project/cat.png?token=...
 */
export class LocalFileProtocolManager {
  private readonly approvedWorkspaceRoots = new Set<string>();

  private readonly externalPreviewApprovals = new Map<string, number>();

  private readonly indexedProjectRoots = new Set<string>();

  private handlerRegistered = false;

  private readonly previewTokens = new Map<string, PreviewTokenRecord>();

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

          const token = url.searchParams.get('token');
          if (!token) {
            return new Response('Forbidden', { status: 403 });
          }

          if (!this.hasPreviewToken(token)) {
            return new Response('Forbidden', { status: 403 });
          }

          const realResolvedPath = normalizeAbsolutePath(await realpath(resolvedPath));
          if (!realResolvedPath || !this.verifyPreviewToken(token, realResolvedPath)) {
            return new Response('Forbidden', { status: 403 });
          }

          const fileStat = await stat(realResolvedPath);
          if (!fileStat.isFile()) {
            return new Response('Not a file', { status: 404 });
          }

          const buffer = await readFile(realResolvedPath);
          const headers = new Headers();
          headers.set('Content-Type', resolveLocalFileMimeType(realResolvedPath, buffer));
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

  async approveWorkspaceRoot(rootPath: string): Promise<string | null> {
    const normalizedRoot = normalizeAbsolutePath(rootPath);
    if (!normalizedRoot) return null;

    const realRoot = normalizeAbsolutePath(await realpath(normalizedRoot));
    if (!realRoot) return null;

    this.approvedWorkspaceRoots.add(realRoot);
    return realRoot;
  }

  async approveWorkspaceRoots(rootPaths: string[] = []): Promise<string[]> {
    const approvedRoots = await Promise.allSettled(
      rootPaths.map((rootPath) => this.approveWorkspaceRoot(rootPath)),
    );

    return approvedRoots
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter((rootPath): rootPath is string => !!rootPath);
  }

  async approveProjectRootFromScope({
    projectRoot,
    requestedScope,
  }: {
    projectRoot: string;
    requestedScope: string;
  }): Promise<string | null> {
    const [realProjectRoot, realRequestedScope] = await Promise.all([
      realpath(projectRoot),
      realpath(requestedScope),
    ]);
    const normalizedProjectRoot = normalizeAbsolutePath(realProjectRoot);
    const normalizedRequestedScope = normalizeAbsolutePath(realRequestedScope);
    if (!normalizedProjectRoot || !normalizedRequestedScope) return null;

    const scopeIsApproved = [...this.approvedWorkspaceRoots].some(
      (approvedRoot) =>
        normalizedRequestedScope === approvedRoot ||
        isPathWithinRoot(normalizedRequestedScope, approvedRoot),
    );
    if (!scopeIsApproved) return null;

    this.approvedWorkspaceRoots.add(normalizedProjectRoot);
    return normalizedProjectRoot;
  }

  async approveIndexedProjectRoot(projectRoot: string): Promise<string | null> {
    const normalizedProjectRoot = normalizeAbsolutePath(projectRoot);
    if (!normalizedProjectRoot) return null;

    const realProjectRoot = normalizeAbsolutePath(await realpath(normalizedProjectRoot));
    if (!realProjectRoot) return null;

    this.indexedProjectRoots.add(realProjectRoot);
    return realProjectRoot;
  }

  async createPreviewUrl({
    accept,
    allowExternalFile,
    filePath,
    workspaceRoot,
  }: {
    accept?: PreviewFileAccept;
    allowExternalFile?: boolean;
    filePath: string;
    workspaceRoot: string;
  }): Promise<string | null> {
    const normalizedFilePath = normalizeAbsolutePath(filePath);
    if (!normalizedFilePath) return null;

    const realFilePath = accept
      ? (
          await this.readPreviewFile({
            accept,
            allowExternalFile,
            filePath,
            workspaceRoot,
          })
        )?.realPath
      : await this.resolveApprovedPreviewPath({ allowExternalFile, filePath, workspaceRoot });
    if (!realFilePath) return null;

    this.cleanupExpiredTokens();

    const token = randomUUID();
    this.previewTokens.set(token, {
      expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
      realPath: realFilePath,
    });

    return buildLocalFileUrl(normalizedFilePath, token);
  }

  async readPreviewFile({
    accept,
    allowExternalFile,
    filePath,
    workspaceRoot,
  }: {
    accept?: PreviewFileAccept;
    allowExternalFile?: boolean;
    filePath: string;
    workspaceRoot: string;
  }): Promise<PreviewFileReadResult | null> {
    const realFilePath = await this.resolveApprovedPreviewPath({
      allowExternalFile,
      filePath,
      persistExternalApproval: false,
      workspaceRoot,
    });
    if (!realFilePath) return null;

    const fileStat = await stat(realFilePath);
    if (!fileStat.isFile()) return null;

    const buffer = await readFile(realFilePath);
    const contentType = resolveLocalFileMimeType(realFilePath, buffer);
    if (!isAcceptedPreviewContentType(contentType, accept)) return null;

    if (allowExternalFile) {
      this.grantExternalPreviewApproval(realFilePath);
    }

    return {
      buffer,
      contentType,
      realPath: realFilePath,
    };
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

  private async resolveApprovedPreviewPath({
    allowExternalFile,
    filePath,
    persistExternalApproval = true,
    workspaceRoot,
  }: {
    allowExternalFile?: boolean;
    filePath: string;
    persistExternalApproval?: boolean;
    workspaceRoot: string;
  }): Promise<string | null> {
    const normalizedFilePath = normalizeAbsolutePath(filePath);
    const normalizedWorkspaceRoot = normalizeAbsolutePath(workspaceRoot);
    if (!normalizedFilePath || !normalizedWorkspaceRoot) return null;

    const [realFilePath, realWorkspaceRoot] = await Promise.all([
      realpath(normalizedFilePath),
      realpath(normalizedWorkspaceRoot),
    ]);
    const normalizedRealFilePath = normalizeAbsolutePath(realFilePath);
    const normalizedRealWorkspaceRoot = normalizeAbsolutePath(realWorkspaceRoot);

    if (!normalizedRealFilePath || !normalizedRealWorkspaceRoot) return null;
    const workspaceRootApproved =
      this.approvedWorkspaceRoots.has(normalizedRealWorkspaceRoot) ||
      this.indexedProjectRoots.has(normalizedRealWorkspaceRoot);
    if (
      workspaceRootApproved &&
      isPathWithinRoot(normalizedRealFilePath, normalizedRealWorkspaceRoot)
    ) {
      return normalizedRealFilePath;
    }

    if (this.hasExternalPreviewApproval(normalizedRealFilePath)) return normalizedRealFilePath;

    if (allowExternalFile) {
      return this.approveExternalPreviewFile(normalizedRealFilePath, {
        persist: persistExternalApproval,
      });
    }

    return null;
  }

  private async approveExternalPreviewFile(
    realFilePath: string,
    { persist = true }: { persist?: boolean } = {},
  ): Promise<string | null> {
    const fileStat = await stat(realFilePath);
    if (!fileStat.isFile()) return null;

    if (persist) {
      this.grantExternalPreviewApproval(realFilePath);
    }

    return realFilePath;
  }

  private grantExternalPreviewApproval(realFilePath: string) {
    this.cleanupExpiredExternalPreviewApprovals();
    this.externalPreviewApprovals.set(realFilePath, Date.now() + EXTERNAL_PREVIEW_APPROVAL_TTL_MS);
  }

  private cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, record] of this.previewTokens) {
      if (record.expiresAt <= now) {
        this.previewTokens.delete(token);
      }
    }
  }

  private cleanupExpiredExternalPreviewApprovals() {
    const now = Date.now();
    for (const [realPath, expiresAt] of this.externalPreviewApprovals) {
      if (expiresAt <= now) {
        this.externalPreviewApprovals.delete(realPath);
      }
    }
  }

  private hasPreviewToken(token: string): boolean {
    const record = this.previewTokens.get(token);
    if (!record) return false;

    if (record.expiresAt <= Date.now()) {
      this.previewTokens.delete(token);
      return false;
    }

    return true;
  }

  private verifyPreviewToken(token: string, realResolvedPath: string): boolean {
    const record = this.previewTokens.get(token);
    if (!record) return false;

    return record.realPath === realResolvedPath;
  }

  private hasExternalPreviewApproval(realFilePath: string): boolean {
    const expiresAt = this.externalPreviewApprovals.get(realFilePath);
    if (!expiresAt) return false;

    if (expiresAt <= Date.now()) {
      this.externalPreviewApprovals.delete(realFilePath);
      return false;
    }

    return true;
  }
}
