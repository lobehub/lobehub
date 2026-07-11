import { OFFICIAL_URL } from '@lobechat/const';

import { getIdFromIdentifier } from '@/utils/identifier';

const ROUTE_ROOTS = new Set(['agent', 'page', 'task', 'tasks']);

export type InternalLinkReference =
  | { agentId: string; pathname: string; type: 'agent' }
  | { agentId?: string; documentId: string; pathname: string; type: 'document' }
  | { pathname: string; type: 'route' }
  | { agentId?: string; pathname: string; taskId: string; type: 'task' };

const getRouteSegments = (pathname: string) => {
  const segments = pathname.split('/').filter(Boolean);
  const routeRootIndex = segments.findIndex((segment) => ROUTE_ROOTS.has(segment));

  if (routeRootIndex < 0) return null;

  return segments.slice(routeRootIndex);
};

const isInternalHost = (url: URL, currentOrigin?: string) => {
  const officialHost = new URL(OFFICIAL_URL).host;
  if (url.host === officialHost) return true;

  if (!currentOrigin) return false;

  try {
    return url.host === new URL(currentOrigin).host;
  } catch {
    return false;
  }
};

/** Parse a LobeHub route into a semantic entity reference. */
export const parseInternalLink = (
  href: string | undefined,
  currentOrigin?: string,
): InternalLinkReference | null => {
  if (!href) return null;

  const isRootRelative = href.startsWith('/');
  let url: URL;

  try {
    url = new URL(href, currentOrigin || OFFICIAL_URL);
  } catch {
    return null;
  }

  if (!isRootRelative && !isInternalHost(url, currentOrigin)) return null;

  const segments = getRouteSegments(url.pathname);
  const pathname = `${url.pathname}${url.search}${url.hash}`;

  if (!segments) return { pathname, type: 'route' };

  if (segments[0] === 'page' && segments[1]) {
    return { documentId: getIdFromIdentifier(segments[1], 'docs'), pathname, type: 'document' };
  }

  if (segments[0] === 'task' && segments[1]) {
    return { pathname, taskId: segments[1], type: 'task' };
  }

  if (segments[0] === 'agent' && segments[1]) {
    const agentId = getIdFromIdentifier(segments[1], 'agt');

    if (segments[2] === 'docs' && segments[3]) {
      return {
        agentId,
        documentId: getIdFromIdentifier(segments[3], 'docs'),
        pathname,
        type: 'document',
      };
    }

    if (segments[2] === 'task' && segments[3]) {
      return { agentId, pathname, taskId: segments[3], type: 'task' };
    }

    if (segments.length === 2) return { agentId, pathname, type: 'agent' };
  }

  return { pathname, type: 'route' };
};
