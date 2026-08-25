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
