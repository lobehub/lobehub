'use client';

import { PropsWithChildren, memo } from 'react';

import Desktop from './Desktop';
import Mobile from './Mobile';

interface DiscoverLayoutProps extends PropsWithChildren {
  mobile?: boolean;
}

const DiscoverLayout = memo<DiscoverLayoutProps>(({ children, mobile }) => {
  if (mobile) {
    return <Mobile>{children}</Mobile>;
  }

  return <Desktop>{children}</Desktop>;
});

DiscoverLayout.displayName = 'DiscoverLayout';

export default DiscoverLayout;
