import semver from 'semver';

const STATIC_ASSET_PATH_PREFIXES = ['/assets/', '/_next/', '/static/'];
const ROOT_STATIC_FILE_RE = /^\/[^/]+\.[^/]+$/;

const isStaticAssetPath = (pathname: string) =>
  ROOT_STATIC_FILE_RE.test(pathname) ||
  STATIC_ASSET_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * Determine if application update is needed rather than just renderer update
 * @param currentVersion Current version
 * @param nextVersion New version
 * @returns Whether application update is needed
 */
export const shouldUpdateApp = (currentVersion: string, nextVersion: string): boolean => {
  // If version contains .app suffix, force application update
  if (nextVersion.includes('.app')) {
    return true;
  }

  try {
    // Parse version number
    const current = semver.parse(currentVersion);
    const next = semver.parse(nextVersion);

    if (!current || !next) return true;

    // Application update needed when major or minor version changes
    if (current.major !== next.major || current.minor !== next.minor) {
      return true;
    }

    // For patch version changes only, prioritize renderer hot update
    return false;
  } catch {
    // Default to application update when parsing fails
    return true;
  }
};

/**
 * Extract a restorable SPA route (`pathname + search`) from a renderer window URL.
 * Returns `null` when the URL is not a restorable route — splash/error pages
 * (`file:` protocol), known static asset paths, or the root route (identical
 * to the default, nothing worth restoring).
 */
export const extractRestoreRoute = (rawUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol === 'file:') return null;
  if (isStaticAssetPath(url.pathname)) return null;

  // `lng` is re-appended by Browser.buildUrlWithLocale on the next load
  url.searchParams.delete('lng');

  const route = `${url.pathname}${url.search}`;
  if (route === '/' || route === '') return null;

  return route;
};
