const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module', // Chrome / Vite
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Failed to load module script', // Safari variant
  'Loading chunk', // Webpack
  'Loading CSS chunk', // Webpack CSS
  'ChunkLoadError', // Webpack error name
];

const SESSION_KEY = 'lobe:chunk-error-reload';
const COOLDOWN_MS = 10_000;

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

/**
 * Try a one-time page reload to recover from a chunk-load failure.
 * Returns `true` if a reload was triggered (caller should bail out).
 *
 * Uses sessionStorage with a cooldown window to prevent infinite reload loops.
 */
export function tryChunkErrorReload(): boolean {
  try {
    const last = window.sessionStorage.getItem(SESSION_KEY);

    if (last && Date.now() - Number(last) < COOLDOWN_MS) {
      return false; // already reloaded recently
    }

    window.sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    // sessionStorage unavailable — attempt reload without guard
    window.location.reload();
    return true;
  }
}

/**
 * Call on successful page load to clear the reload guard,
 * so future chunk errors can trigger a fresh reload.
 */
export function clearChunkErrorReloadFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
