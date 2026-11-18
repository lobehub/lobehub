import { useEffect } from 'react';
import { useBlocker } from 'react-router';

const EMBED_PATH_PREFIX = '/embed/agent/';

/** Whether an in-app navigation from the embed panel stays on an embed page. */
export const isEmbedPathname = (pathname: string) => pathname.startsWith(EMBED_PATH_PREFIX);

/**
 * `frame-ancestors` is checked only when a document loads, so an in-app
 * navigation from the panel would otherwise render a route that refuses to be
 * framed inside the host website. While framed, such a navigation opens in a
 * new tab instead and the panel stays on its conversation.
 */
export const useFramedNavigationGuard = (framed: boolean) => {
  const blocker = useBlocker(
    ({ nextLocation }) => framed && !isEmbedPathname(nextLocation.pathname),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    const { hash, pathname, search } = blocker.location;
    window.open(`${pathname}${search}${hash}`, '_blank', 'noopener,noreferrer');
    blocker.reset();
  }, [blocker]);
};
