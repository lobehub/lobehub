'use client';

import type {AnchorHTMLAttributes, FC} from 'react';
import { Link } from 'react-router-dom';

const EXTERNAL_HREF_REGEX = /https?:\/\//;

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
}

const A: FC<LinkProps> = ({ href = '', children, ...props }) => {
  const isOutbound = EXTERNAL_HREF_REGEX.test(href as string);
  const isOfficial = String(href).includes('lobechat') || String(href).includes('lobehub');

  // External links use native <a> tag
  if (isOutbound) {
    return (
      <a
        href={href}
        rel={isOfficial ? 'noreferrer' : 'nofollow noreferrer'}
        target="_blank"
        {...props}
      >
        {children}
      </a>
    );
  }

  // Internal links use React Router
  return (
    <Link to={href} {...props}>
      {children}
    </Link>
  );
};

export default A;
