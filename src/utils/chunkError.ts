import { toast } from '@lobehub/ui/base-ui';

const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module', // Chrome / Vite
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Failed to load module script', // Safari variant
  'Loading chunk', // Webpack
  'Loading CSS chunk', // Webpack CSS
  'ChunkLoadError', // Webpack error name
];

/**
 * Detect whether an error (or its message) was caused by a failed chunk / dynamic import.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  const name = (error as Error).name ?? '';
  const message = (error as Error).message ?? String(error);
  const combined = `${name} ${message}`;

  return CHUNK_ERROR_PATTERNS.some((p) => combined.includes(p));
}

const RELOAD_KEY = 'lobe-chunk-reload';

const notifiedErrors = new WeakSet<object>();

// One failed import() surfaces several times — `vite:preloadError`, then the
// rethrown `unhandledrejection`, then the router ErrorBoundary render — all
// carrying the same Error instance. Only the first one may act on it.
function isAlreadyNotified(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (notifiedErrors.has(error)) return true;

  notifiedErrors.add(error);
  return false;
}

/**
 * Auto-reload on chunk load error. Uses sessionStorage to prevent infinite reload loops.
 */
export function notifyChunkError(error?: unknown): void {
  if (isAlreadyNotified(error)) return;

  // The flag is deliberately never cleared: it must stay monotonic so a chunk
  // that is still missing after the reload lands on the toast instead of
  // re-arming another reload.
  if (sessionStorage.getItem(RELOAD_KEY)) {
    toast.error('There is a new version for the web app. Refresh the page to update');
    return;
  }

  sessionStorage.setItem(RELOAD_KEY, '1');
  window.location.reload();
}
