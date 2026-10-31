/**
 * Shared links are meant to be passed around, not indexed.
 *
 * Rendered documents already carry a `robots` meta tag (see `app/lib/seo.ts`), but that only
 * covers responses that render a head: redirects, `share/t/:id/llm.txt` and error pages ship no
 * directive of their own. The header covers every response instead.
 *
 * Both signals only work while crawlers are allowed to fetch the URL — the apex robots.txt must
 * not disallow `/share/*`, otherwise the directive stays unread and the URL can still be listed.
 */
export const NO_INDEX_DIRECTIVE = 'noindex, nofollow';

export const withNoIndexHeader = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', NO_INDEX_DIRECTIVE);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
