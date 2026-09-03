import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { OFFICIAL_SITE, OFFICIAL_URL } from '@lobechat/const';

import { getIdFromIdentifier } from '@/utils/identifier';

const ROUTE_ROOTS = new Set(['acceptance', 'agent', 'page', 'task', 'tasks', 'verify']);
const BUILTIN_AGENT_SLUG_SET = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));
const NON_SPA_ROUTE_ROOTS = new Set(['_next', 'api', 'f', 'oidc', 'trpc', 'webapi']);
const SPA_ROUTE_ROOTS = new Set([
  'agent',
  'acceptance',
  'community',
  'apps',
  'eval',
  'group',
  'image',
  'memory',
  'page',
  'resource',
  'settings',
  'task',
  'tasks',
  'video',
  'verify',
]);

export type InternalLinkReference =
  | { acceptanceId: string; pathname: string; type: 'acceptance'; workspaceSlug?: string }
  | { agentId: string; pathname: string; type: 'agent'; workspaceSlug?: string }
  | {
      agentId?: string;
      documentId: string;
      pathname: string;
      type: 'document';
      workspaceSlug?: string;
    }
  | { pathname: string; type: 'route'; workspaceSlug?: string }
  | { pathname: string; runId: string; type: 'verify'; workspaceSlug?: string }
  | {
      agentId?: string;
      pathname: string;
      taskId: string;
      type: 'task';
      workspaceSlug?: string;
    };

const getRouteSegments = (pathname: string, workspaceSlugs: ReadonlySet<string>) => {
  const segments = pathname.split('/').filter(Boolean);

  if (ROUTE_ROOTS.has(segments[0])) return { segments, workspaceSlug: undefined };
  if (workspaceSlugs.has(segments[0]) && ROUTE_ROOTS.has(segments[1])) {
    return { segments: segments.slice(1), workspaceSlug: segments[0] };
  }

  return null;
};

const isInternalHost = (url: URL, currentOrigin?: string) => {
  const officialHosts = new Set([new URL(OFFICIAL_SITE).host, new URL(OFFICIAL_URL).host]);
  if (!currentOrigin) return officialHosts.has(url.host);

  try {
    const originUrl = new URL(currentOrigin);
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
      return officialHosts.has(url.host);
    }

    return (
      url.host === originUrl.host ||
      (officialHosts.has(originUrl.host) && officialHosts.has(url.host))
    );
  } catch {
    return false;
  }
};

/**
 * Whether a link's visible text is just the pasted address rather than
 * something a human wrote. Only such a label may be replaced by the entity's
 * resolved title; authored link text is the author's choice and stays.
 *
 * Exact equality, not a URL-shaped prefix test: for an autolink the rehype
 * pass sets the label to the canonical form, which for an internal link IS
 * the href — while `[https://docs.example](/task/1)` is authored text that
 * merely looks like a URL and must survive.
 */
export const isBareLinkLabel = (label: string, href: string) => label === href;

/** Parse a LobeHub route into a semantic entity reference. */
export const parseInternalLink = (
  href: string | undefined,
  currentOrigin?: string,
  workspaceSlugs: readonly string[] = [],
): InternalLinkReference | null => {
  if (!href) return null;

  const isRootRelative = href.startsWith('/') && !href.startsWith('//');
  let url: URL;

  try {
    url = new URL(href, currentOrigin || OFFICIAL_URL);
  } catch {
    return null;
  }

  if (!isRootRelative && !isInternalHost(url, currentOrigin)) return null;

  const route = getRouteSegments(url.pathname, new Set(workspaceSlugs));
  const pathname = `${url.pathname}${url.search}${url.hash}`;

  if (!route) {
    const rootSegment = url.pathname.split('/').find(Boolean);

    if (
      !rootSegment ||
      NON_SPA_ROUTE_ROOTS.has(rootSegment) ||
      (!SPA_ROUTE_ROOTS.has(rootSegment) && !workspaceSlugs.includes(rootSegment))
    ) {
      return null;
    }

    const workspaceSlug = workspaceSlugs.includes(rootSegment) ? rootSegment : undefined;

    return { pathname, type: 'route', ...(workspaceSlug ? { workspaceSlug } : {}) };
  }

  const { segments, workspaceSlug } = route;

  if (segments[0] === 'acceptance' && segments[1]) {
    return {
      acceptanceId: segments[1],
      pathname,
      type: 'acceptance',
      ...(workspaceSlug ? { workspaceSlug } : {}),
    };
  }

  if (segments[0] === 'page' && segments[1]) {
    return {
      documentId: getIdFromIdentifier(segments[1], 'docs'),
      pathname,
      type: 'document',
      ...(workspaceSlug ? { workspaceSlug } : {}),
    };
  }

  if (segments[0] === 'task' && segments[1]) {
    return {
      pathname,
      taskId: segments[1],
      type: 'task',
      ...(workspaceSlug ? { workspaceSlug } : {}),
    };
  }

  if (segments[0] === 'verify' && segments[1]) {
    return {
      pathname,
      runId: segments[1],
      type: 'verify',
      ...(workspaceSlug ? { workspaceSlug } : {}),
    };
  }

  if (segments[0] === 'agent' && segments[1]) {
    if (BUILTIN_AGENT_SLUG_SET.has(segments[1])) return { pathname, type: 'route' };

    const agentId = segments[1];

    if (segments[2] === 'docs' && segments[3]) {
      return {
        agentId,
        documentId: getIdFromIdentifier(segments[3], 'docs'),
        pathname,
        type: 'document',
        ...(workspaceSlug ? { workspaceSlug } : {}),
      };
    }

    if (segments[2] === 'task' && segments[3]) {
      return {
        agentId,
        pathname,
        taskId: segments[3],
        type: 'task',
        ...(workspaceSlug ? { workspaceSlug } : {}),
      };
    }

    if (segments.length === 2) {
      return { agentId, pathname, type: 'agent', ...(workspaceSlug ? { workspaceSlug } : {}) };
    }
  }

  return { pathname, type: 'route', ...(workspaceSlug ? { workspaceSlug } : {}) };
};
