import NextLink, { type LinkProps as NextLinkProps } from 'next/link';
import React, { memo } from 'react';

interface LinkProps extends NextLinkProps {
  children?: React.ReactNode | undefined;
}

const Link = memo<LinkProps>((props) => {
  return <NextLink {...props} prefetch={false} />;
});

export default Link;
