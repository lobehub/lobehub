/**
 * Match Agent subroutes, not arbitrary substrings: `/channels/:id` and workspace
 * slugs such as `channel-team` must not light up the profile entry.
 */
export const isAgentProfileRoute = (pathname: string) =>
  /^(?:\/[^/]+)?\/agent\/[^/]+\/(?:profile|channel(?:\/[^/]+)?|statistics)\/?$/.test(
    pathname.replace(/^\/_dangerous_local_dev_proxy(?=\/)/, ''),
  );
