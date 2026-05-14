import { isDesktop } from './version';

export const ELECTRON_BE_PROTOCOL_SCHEME = 'lobe-backend';

export const withElectronProtocolIfElectron = (url: string) => {
  return isDesktop ? `${ELECTRON_BE_PROTOCOL_SCHEME}://lobe${url}` : url;
};

/**
 * Custom protocol the desktop main process exposes for serving arbitrary
 * absolute local-disk files to the renderer (e.g. project file previews).
 * Backed by `LocalFileProtocolManager` in
 * `apps/desktop`.
 */
export const LOCAL_FILE_PROTOCOL_SCHEME = 'localfile';
export const LOCAL_FILE_PROTOCOL_HOST = 'file';

/**
 * Build a `localfile://file/<abs-path>` URL from an absolute filesystem path.
 *
 * - POSIX  `/Users/a/img.png`     -> `localfile://file/Users/a/img.png`
 * - Win32  `C:\\Users\\a\\img.png` -> `localfile://file/C:/Users/a/img.png`
 *
 * Each path segment is percent-encoded so spaces / unicode / `?` / `#`
 * survive the URL round-trip. The `/` separator itself is preserved.
 * Returns `null` when the input is empty or not an absolute path.
 */
export const buildLocalFileUrl = (absolutePath: string | null | undefined): string | null => {
  if (!absolutePath) return null;

  // Normalize Windows backslashes so the URL pathname uses forward slashes.
  const forwardSlashed = absolutePath.replaceAll('\\', '/');

  const isWindowsAbsolute = /^[a-z]:\//i.test(forwardSlashed);
  const isPosixAbsolute = forwardSlashed.startsWith('/');
  if (!isWindowsAbsolute && !isPosixAbsolute) return null;

  // Drop the leading slash on POSIX paths so we get exactly one `/` between
  // host and the encoded path (the protocol handler re-adds it).
  const stripped = isPosixAbsolute ? forwardSlashed.slice(1) : forwardSlashed;

  const encoded = stripped.split('/').map(encodeURIComponent).join('/');

  return `${LOCAL_FILE_PROTOCOL_SCHEME}://${LOCAL_FILE_PROTOCOL_HOST}/${encoded}`;
};
