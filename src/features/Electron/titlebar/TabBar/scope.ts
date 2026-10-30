import { parseRootSegment, RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';

import { normalizeTabUrl } from './url';

export type TabScope =
  | {
      type: 'personal';
    }
  | {
      slug: string;
      type: 'workspace';
    };

export interface ScopedTabTarget {
  scope?: TabScope;
  url: string;
}

export const PERSONAL_TAB_SCOPE: TabScope = { type: 'personal' };

export const resolveTabScope = (url: string): TabScope => {
  const [pathname = '/'] = url.split(/[?#]/);
  const firstSegment = parseRootSegment(pathname);

  // Any root that is not a workspace slug opens in the personal bucket.
  if (!firstSegment || RESERVED_ROOT_SEGMENTS.has(firstSegment)) return PERSONAL_TAB_SCOPE;

  return { slug: firstSegment, type: 'workspace' };
};

export const tabScopeHomeUrl = (scope: TabScope): string =>
  scope.type === 'workspace' ? `/${scope.slug}` : '/';

export const tabScopeKey = (scope: TabScope): string =>
  scope.type === 'personal' ? 'personal' : `workspace:${encodeURIComponent(scope.slug)}`;

export const resolveTabScopeKey = (url: string): string => tabScopeKey(resolveTabScope(url));

export const normalizeTabScope = (scope: unknown, url: string): TabScope => {
  if (!scope || typeof scope !== 'object') return resolveTabScope(url);

  const typedScope = scope as Partial<TabScope>;
  if (typedScope.type === 'personal') return PERSONAL_TAB_SCOPE;
  if (
    typedScope.type === 'workspace' &&
    'slug' in typedScope &&
    typeof typedScope.slug === 'string' &&
    typedScope.slug.length > 0
  ) {
    return { slug: typedScope.slug, type: 'workspace' };
  }

  return resolveTabScope(url);
};

export const isSameTabScope = (a: TabScope, b: TabScope): boolean => {
  if (a.type !== b.type) return false;
  return a.type === 'personal' || a.slug === (b as Extract<TabScope, { type: 'workspace' }>).slug;
};

export const isSameTabTarget = (target: ScopedTabTarget, url: string): boolean =>
  normalizeTabUrl(target.url) === normalizeTabUrl(url);

export const tabTargetId = (url: string): string => normalizeTabUrl(url);
