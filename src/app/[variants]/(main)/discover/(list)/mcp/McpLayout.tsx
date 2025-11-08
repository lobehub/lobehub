'use client';

import { PropsWithChildren, memo } from 'react';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';

interface McpLayoutProps extends PropsWithChildren {
  mobile?: boolean;
}

const McpLayout = memo<McpLayoutProps>(({ children, mobile }) => {
  if (mobile) {
    return <Mobile>{children}</Mobile>;
  }
  return <Desktop>{children}</Desktop>;
});

McpLayout.displayName = 'McpLayout';

export default McpLayout;
