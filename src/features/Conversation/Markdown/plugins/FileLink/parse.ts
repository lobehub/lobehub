import { OFFICIAL_CLOUD_URL, OFFICIAL_URL } from '@lobechat/const';

export const LOBE_FILE_LINK_TAG = 'lobeFileLink';

/**
 * The hosts that serve the same cloud app: the `lobehub.com` gateway apex and
 * `app.lobehub.com`. File links keep whichever one was current when they were
 * written. Other `*.lobehub.com` hosts (staging, gateways) are different
 * backends and must not be treated as this app.
 */
const OFFICIAL_APP_ORIGINS = new Set([
  new URL(OFFICIAL_URL).origin,
  new URL(OFFICIAL_CLOUD_URL).origin,
]);

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
      const current = new URL(currentOrigin).origin;
      const sameApp =
        url.origin === current ||
        (OFFICIAL_APP_ORIGINS.has(url.origin) && OFFICIAL_APP_ORIGINS.has(current));
      if (!sameApp) return null;
    } catch {
      return null;
    }
  }

  const match = url.pathname.match(FILE_PROXY_PATH_REGEX);
  if (!match) return null;

  try {
    return { fileId: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
};

// A link label that names a file, e.g. `report.md` or `action-items.csv`.
const FILE_NAME_WITH_EXTENSION_REGEX = /\.[\da-z]{1,10}$/i;

export type FileLinkOpenAction =
  | { kind: 'preview'; params: { fileId: string; source?: { name: string; url: string } } }
  | { kind: 'newTab'; url: string };

/**
 * What a file link click opens.
 *
 * The agent-share visitor does not own the creator's files, so the portal's
 * owner-scoped fetch by id finds nothing and shows "file unavailable"; the
 * `/f/:id` link itself is public by id, so the visitor previews straight from
 * it. That preview only knows the file through the link label (the FileViewer
 * picks its renderer from the name's extension), so a label such as
 * "Download the deck" opens the public link in a new tab instead of a preview
 * that would render the file with the wrong viewer.
 */
export const getFileLinkOpenAction = ({
  fileId,
  isAgentShareVisitor,
  label,
  linkHref,
}: {
  fileId: string;
  isAgentShareVisitor: boolean;
  label: string;
  linkHref?: string;
}): FileLinkOpenAction => {
  if (!isAgentShareVisitor || !linkHref) return { kind: 'preview', params: { fileId } };

  if (!FILE_NAME_WITH_EXTENSION_REGEX.test(label.trim())) return { kind: 'newTab', url: linkHref };

  return { kind: 'preview', params: { fileId, source: { name: label.trim(), url: linkHref } } };
};
