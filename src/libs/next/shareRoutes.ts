const SHARE_TOPIC_ROUTE = /^\/share\/t\/[^/]+\/?$/;
const SHARE_PAGE_ROUTE = /^\/share\/page\/[^/]+\/?$/;
const SHARE_ARTIFACT_ROUTE = /^\/share\/artifact\/[^/]+\/?$/;

const pathOnly = (pathname: string) => pathname.split(/[?#]/, 1)[0]!;

/** Every path the standalone Share app owns. */
export const isShareSpaRoute = (pathname: string): boolean => {
  const path = pathOnly(pathname);

  return (
    SHARE_TOPIC_ROUTE.test(path) || SHARE_PAGE_ROUTE.test(path) || SHARE_ARTIFACT_ROUTE.test(path)
  );
};

/**
 * Shared links are meant to be passed around, not indexed.
 *
 * The share document already carries a `robots` meta tag (`spa-share`, per-topic OG in the
 * Cloudflare worker build). The header states the same directive for every share response
 * instead of only the ones that render a head.
 *
 * Neither signal counts while crawlers are blocked from fetching the URL, which is why the apex
 * robots.txt allows these routes on top of its `/share/*` block.
 */
export const SHARE_NO_INDEX_DIRECTIVE = 'noindex, nofollow';

export const withShareNoIndexHeader = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', SHARE_NO_INDEX_DIRECTIVE);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
