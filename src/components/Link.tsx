import { type AnchorHTMLAttributes } from 'react';
import React, { memo } from 'react';
import { Link as RouterLink } from 'react-router-dom';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children?: React.ReactNode | undefined;
  href?: string;
}

/**
 * Smart Link component for global use.
 * - External links (http://, https://) → native <a> tag
 * - Internal routes → React Router Link
 */
const Link = memo<LinkProps>(({ href, children, ...props }) => {
  // External links use native <a> tag
  if (href?.startsWith('http://') || href?.startsWith('https://')) {
    return (
      <a href={href} rel="noreferrer" {...props}>
        {children}
      </a>
    );
  }

  // Internal routes use React Router Link
  return (
    <RouterLink to={href || '/'} {...props}>
      {children}
    </RouterLink>
  );
});

export default Link;
