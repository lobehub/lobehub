import React, { memo } from 'react';
import { type LinkProps as ReactRouterLinkProps } from 'react-router-dom';
import { Link as ReactRouterLink } from 'react-router-dom';

interface LinkProps extends Omit<ReactRouterLinkProps, 'to'> {
  children?: React.ReactNode;
  href?: string;
  to?: string;
}

/**
 * Link component for React Router
 * Provides a Next.js-like API (href prop) while using React Router internally
 */
const Link = memo<LinkProps>(({ href, to, ...props }) => {
  const linkTo = href || to || '/';
  return <ReactRouterLink {...props} to={linkTo} />;
});

Link.displayName = 'Link';

export default Link;
