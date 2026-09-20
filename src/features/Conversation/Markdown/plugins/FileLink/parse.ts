export const LOBE_FILE_LINK_TAG = 'lobeFileLink';

// Matches this app's own file proxy path, e.g. `${APP_URL}/f/:fileId`
// (see server/routers/lambda/file.ts -> getFileProxyUrl). This is deliberately
// narrower than Link/internalLink.ts's NON_SPA_ROUTE_ROOTS exclusion of `/f`:
// that keeps the generic link classifier out of the file proxy entirely, so
// this plugin claims the anchor first and gives it its own preview affordance.
const FILE_PROXY_PATH_REGEX = /^\/f\/([^/?#]+)\/?$/;

export interface ParsedFileLink {
  fileId: string;
}

export const parseFileLinkHref = (
  href: string | undefined,
  currentOrigin?: string,
): ParsedFileLink | null => {
  if (!href) return null;

  const isRootRelative = href.startsWith('/') && !href.startsWith('//');
  let url: URL;

  try {
    url = new URL(href, currentOrigin || 'https://lobehub.com');
  } catch {
    return null;
  }

  // Only intercept links that point back at this app's own file proxy, never
  // an externally hosted link that happens to share the path shape. A
  // root-relative href is inherently same-origin; an absolute one needs an
  // explicit origin to compare against, so without one it's left alone.
  if (!isRootRelative) {
    if (!currentOrigin) return null;

    try {
      if (url.origin !== new URL(currentOrigin).origin) return null;
    } catch {
      return null;
    }
  }

  const match = url.pathname.match(FILE_PROXY_PATH_REGEX);
  return match ? { fileId: decodeURIComponent(match[1]) } : null;
};
