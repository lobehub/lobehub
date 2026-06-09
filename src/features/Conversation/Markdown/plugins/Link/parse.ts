export const LOBE_LINK_TAG = 'lobeLink';

export type LobeLinkKind = 'github' | 'linear' | 'email' | 'generic';

export interface ParsedLobeLink {
  /**
   * Canonical label used when the link has no author-provided text, e.g.
   * `lobehub/lobehub#15554` / `LOBE-10141` / `@lobehub/ui` / the full URL.
   */
  canonicalLabel: string;
  /** Host for generic links, used to fetch a favicon. */
  domain?: string;
  kind: LobeLinkKind;
}

const stripWww = (host: string) => host.replace(/^www\./, '');

/** npmjs.com/package/<name> → `<name>` (handles scoped packages and versions). */
const npmPackageName = (segments: string[]): string | undefined => {
  const idx = segments.indexOf('package');
  const rest = idx >= 0 ? segments.slice(idx + 1) : [];
  if (rest.length === 0) return undefined;
  return rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
};

/** figma.com/(file|design)/<key>/<name> → the human file name. */
const figmaFileName = (segments: string[]): string | undefined => {
  if ((segments[0] === 'file' || segments[0] === 'design') && segments[2]) {
    try {
      return decodeURIComponent(segments[2]).replaceAll('-', ' ');
    } catch {
      return segments[2];
    }
  }
  return undefined;
};

/**
 * Classify an href and derive a canonical short label.
 *
 * - GitHub repo / PR / issue / commit and Linear issues get a rich label.
 * - npm packages / Figma files keep their favicon but get a friendly label.
 * - `mailto:` links become an `email` chip.
 * - Any other absolute http(s) link becomes a `generic` chip (favicon + full URL).
 * - Citation links (`citation-1`), footnote refs, anchors and relative paths
 *   return `null` and keep the default link renderer untouched.
 */
export const parseLobeLink = (href?: string): ParsedLobeLink | null => {
  if (!href) return null;

  if (href.startsWith('mailto:')) {
    const email = href.slice('mailto:'.length).split('?')[0];
    return email ? { canonicalLabel: email, kind: 'email' } : null;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = stripWww(url.hostname);
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'github.com') {
    const [owner, repo, type, id] = segments;
    if (owner) {
      if (repo) {
        if ((type === 'pull' || type === 'issues') && id) {
          return { canonicalLabel: `${owner}/${repo}#${id}`, kind: 'github' };
        }
        if (type === 'commit' && id) {
          return { canonicalLabel: `${owner}/${repo}@${id.slice(0, 7)}`, kind: 'github' };
        }
        return { canonicalLabel: `${owner}/${repo}`, kind: 'github' };
      }
      // user / org page → keep the GitHub icon, show the handle
      return { canonicalLabel: owner, kind: 'github' };
    }
    // bare github.com → fall through to generic
  }

  if (host === 'linear.app') {
    // workspace/issue/LOBE-123/slug
    const issueIndex = segments.indexOf('issue');
    const id = issueIndex >= 0 ? segments[issueIndex + 1] : undefined;
    if (id) return { canonicalLabel: id.toUpperCase(), kind: 'linear' };
    // fall through to generic
  }

  // Generic chip: favicon + a friendly label, falling back to the full URL.
  const friendlyLabel =
    (host === 'npmjs.com' && npmPackageName(segments)) ||
    (host === 'figma.com' && figmaFileName(segments)) ||
    href;

  return { canonicalLabel: friendlyLabel, domain: host, kind: 'generic' };
};
