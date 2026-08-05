export type GreetingHrefKind = 'external' | 'internal' | 'unsafe';

/**
 * Generated greeting links may only target an app-relative path or an HTTP(S)
 * URL. Treat every other scheme as plain text so generated content cannot
 * create executable `javascript:` / `data:` links.
 */
export const classifyGreetingHref = (href: string): GreetingHrefKind => {
  if (/^https?:\/\//i.test(href)) return 'external';
  if (href.startsWith('/') && !href.startsWith('//')) return 'internal';
  return 'unsafe';
};
