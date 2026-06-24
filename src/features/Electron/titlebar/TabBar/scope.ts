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

const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

const PERSONAL_TOP_LEVEL_SEGMENTS = new Set([
  'agent',
  'community',
  'desktop-onboarding',
  'devtools',
  'eval',
  'fleet',
  'group',
  'image',
  'invite',
  'me',
  'memory',
  'onboarding',
  'page',
  'resource',
  'settings',
  'share',
  'task',
  'tasks',
  'verify',
  'verify-im',
  'video',
]);

export const PERSONAL_TAB_SCOPE: TabScope = { type: 'personal' };

export const resolveTabScope = (url: string): TabScope => {
  const [pathname = '/'] = url.split(/[?#]/);
  const firstSegment = FIRST_SEGMENT_REGEX.exec(pathname)?.[1];

  if (!firstSegment || PERSONAL_TOP_LEVEL_SEGMENTS.has(firstSegment)) return PERSONAL_TAB_SCOPE;

  return { slug: firstSegment, type: 'workspace' };
};

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

export const isSameTabTarget = (
  target: ScopedTabTarget,
  url: string,
  scope: TabScope = resolveTabScope(url),
): boolean =>
  normalizeTabUrl(target.url) === normalizeTabUrl(url) &&
  isSameTabScope(normalizeTabScope(target.scope, target.url), scope);

export const tabTargetId = (url: string): string => normalizeTabUrl(url);
