/**
 * Link adapter — maps Next.js Link API (href prop) to react-router-dom Link (to prop).
 * External URLs (http/https) are rendered as plain <a> tags.
 */

import { type AnchorHTMLAttributes } from 'react';
import { Link as RRLink } from 'react-router';

import { authSpaRoutes, nextjsOnlyRoutes } from './nextjsOnlyRoutes';
import { shouldHardNavigateToWorkbench } from './workbenchNavigation';

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
}

const hardNavRoutes = [...nextjsOnlyRoutes, ...authSpaRoutes];

const isExternalOrNextOnly = (href: string) =>
  href.startsWith('http://') ||
  href.startsWith('https://') ||
  href.startsWith('//') ||
  hardNavRoutes.some(
    (route) => href === route || href.startsWith(`${route}/`) || href.startsWith(`${route}?`),
  );

const Link = ({
  ref,
  href,
  replace,
  prefetch: _prefetch,
  scroll: _scroll,
  children,
  ...rest
}: LinkProps & { ref?: React.RefObject<HTMLAnchorElement | null> }) => {
  if (isExternalOrNextOnly(href) || shouldHardNavigateToWorkbench(href)) {
    return (
      <a href={href} ref={ref} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RRLink ref={ref} replace={replace} to={href} {...rest}>
      {children}
    </RRLink>
  );
};

Link.displayName = 'Link';

export default Link;
