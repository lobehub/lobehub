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

// Where Docs opens an uploaded file: `/resource/file/:fileId` (what `lh` prints),
// the pre-Docs `/resource?file=:fileId`, and a library item
// `/resource/library/:libraryId?file=:fileId`.
const DOCS_FILE_PATH_REGEX = /^\/resource\/file\/([^/?#]+)\/?$/;
const DOCS_FILE_QUERY_PATH_REGEX = /^\/resource(?:\/library\/[^/?#]+)?\/?$/;

// Docs addresses also open pages (`docs_*`), which are not files: the legacy
// `?file=docs_x` redirects to `/resource/file/docs_x`. Only an uploaded file
// previews in the file panel; older uploads carry bare UUID ids, so pages are
// excluded by prefix rather than files matched by one.
const PAGE_ID_PREFIX = 'docs_';

const asUploadedFileId = (id: string | null | undefined): string | null =>
  id && !id.startsWith(PAGE_ID_PREFIX) ? id : null;

export interface ParsedFileLink {
  fileId: string;
  /**
   * The public `/f/:id` address of the same file, root-relative. A Docs link is
   * a page of the app, readable only in the owner's scope; the proxy is what a
   * share visitor can open. Root-relative keeps the first hop on the page's own
   * origin, so the redirect to storage keeps the Origin the bucket allows and
   * the preview can `fetch` text files (an absolute app address from another
   * origin taints it).
   */
  proxyHref: string;
  /**
   * `active` when the link addresses the scope this client reads (or names no
   * scope: the `/f/:id` proxy is addressed by id alone); `foreign` for a
   * personal-space link inside a workspace or another workspace's link. The
   * owner opens a foreign link by navigating; a share visitor reads every one
   * through the proxy, since a share page has no workspace of its own.
   */
  scope: 'active' | 'foreign';
}

export interface ParseFileLinkOptions {
  /**
   * The active workspace's slug. A Docs link written in a workspace is prefixed
   * with its slug; only the active one resolves through this client's file store.
   */
  activeWorkspaceSlug?: string | null;
}

const safeDecode = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/** The file id a Docs path names, or null. `pathname` has no workspace prefix. */
const matchDocsFile = (pathname: string, searchParams: URLSearchParams): string | null => {
  const pathMatch = pathname.match(DOCS_FILE_PATH_REGEX);
  if (pathMatch) return asUploadedFileId(safeDecode(pathMatch[1]));

  if (DOCS_FILE_QUERY_PATH_REGEX.test(pathname)) return asUploadedFileId(searchParams.get('file'));

  return null;
};

const isDocsPath = (pathname: string) =>
  pathname === '/resource' || pathname.startsWith('/resource/');

/**
 * Split a Docs link into its scope and its unprefixed Docs path, or null when
 * it is not a Docs path. Workspace routes always carry `/{slug}`, so an
 * unprefixed path is the personal space: active only outside a workspace.
 */
const resolveDocsScope = (
  pathname: string,
  activeWorkspaceSlug?: string | null,
): { docsPathname: string; scope: ParsedFileLink['scope'] } | null => {
  if (isDocsPath(pathname)) {
    return { docsPathname: pathname, scope: activeWorkspaceSlug ? 'foreign' : 'active' };
  }

  const match = pathname.match(/^\/([^/]+)(\/.*)$/);
  if (!match || !isDocsPath(match[2])) return null;

  return {
    docsPathname: match[2],
    scope: safeDecode(match[1]) === activeWorkspaceSlug ? 'active' : 'foreign',
  };
};

export const parseFileLinkHref = (
  href: string | undefined,
  currentOrigin?: string,
  { activeWorkspaceSlug }: ParseFileLinkOptions = {},
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

  // Root-relative on purpose; see `ParsedFileLink.proxyHref`.
  const toProxyHref = (fileId: string) => `/f/${encodeURIComponent(fileId)}`;

  const proxyMatch = url.pathname.match(FILE_PROXY_PATH_REGEX);
  if (proxyMatch) {
    const fileId = safeDecode(proxyMatch[1]);
    return fileId ? { fileId, proxyHref: toProxyHref(fileId), scope: 'active' } : null;
  }

  const docs = resolveDocsScope(url.pathname, activeWorkspaceSlug);
  if (!docs) return null;
  const { docsPathname, scope } = docs;

  const fileId = matchDocsFile(docsPathname, url.searchParams);
  return fileId ? { fileId, proxyHref: toProxyHref(fileId), scope } : null;
};

// A link label that names a file, e.g. `report.md` or `action-items.csv`.
const FILE_NAME_WITH_EXTENSION_REGEX = /\.[\da-z]{1,10}$/i;

export type FileLinkOpenAction =
  | { kind: 'preview'; params: { fileId: string; source?: { name: string; url: string } } }
  | { kind: 'newTab'; url: string };

/**
 * What a file link click opens.
 *
 * A share visitor (agent or topic share) does not own the creator's files, so the portal's
 * owner-scoped fetch by id finds nothing and shows "file unavailable"; the
 * `/f/:id` link itself is public by id, so the visitor previews straight from
 * it. That preview only knows the file through the link label (the FileViewer
 * picks its renderer from the name's extension), so a label such as
 * "Download the deck" opens the public link in a new tab instead of a preview
 * that would render the file with the wrong viewer.
 */
export const getFileLinkOpenAction = ({
  fileId,
  isShareVisitor,
  label,
  proxyHref,
}: {
  fileId: string;
  isShareVisitor: boolean;
  label: string;
  /** The public `/f/:id` address; see {@link ParsedFileLink.proxyHref}. */
  proxyHref?: string;
}): FileLinkOpenAction => {
  if (!isShareVisitor || !proxyHref) return { kind: 'preview', params: { fileId } };

  if (!FILE_NAME_WITH_EXTENSION_REGEX.test(label.trim())) {
    return { kind: 'newTab', url: proxyHref };
  }

  return { kind: 'preview', params: { fileId, source: { name: label.trim(), url: proxyHref } } };
};

/**
 * Whether the conversation is read through a share page (agent or topic
 * share). Its reader does not own the creator's files: the owner-scoped file
 * store holds none of them (and is an empty stub during share SSR).
 */
export const isShareVisitorContext = (context: {
  agentShareId?: string | null;
  topicShareId?: string | null;
}): boolean => !!context.agentShareId || !!context.topicShareId;

/**
 * Where the link points for this reader: the address as written for the
 * owner, the public proxy for a share visitor (the Docs page is the owner's
 * scope). The anchor's own `href` uses it too, so a modifier or middle click
 * opens the same target an ordinary click previews.
 */
export const getFileLinkTargetHref = ({
  isShareVisitor,
  linkHref,
  proxyHref,
}: {
  isShareVisitor: boolean;
  linkHref?: string;
  proxyHref?: string;
}): string | undefined => (isShareVisitor ? (proxyHref ?? linkHref) : linkHref);

/** The copy button's address: the link target, made absolute against `origin`. */
export const getFileLinkCopyHref = ({
  origin,
  ...link
}: {
  isShareVisitor: boolean;
  linkHref?: string;
  origin: string;
  proxyHref?: string;
}): string | undefined => {
  const href = getFileLinkTargetHref(link);
  if (!href) return undefined;

  try {
    return new URL(href, origin).toString();
  } catch {
    return undefined;
  }
};

/**
 * The app server's origin a copied link resolves against. On desktop the
 * renderer's own origin (`app://renderer`) is not that server; the remote
 * server URL is (trailing slashes trimmed, as a self-hosted URL may carry one).
 */
export const resolveAppOrigin = ({
  isDesktop,
  remoteServerUrl,
  windowOrigin,
}: {
  isDesktop: boolean;
  remoteServerUrl: () => string;
  windowOrigin: () => string;
}): string => (isDesktop ? remoteServerUrl().replace(/\/+$/, '') : windowOrigin());
