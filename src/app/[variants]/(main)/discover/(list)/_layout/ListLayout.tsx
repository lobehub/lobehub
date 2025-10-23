'use client';

import { PropsWithChildren, memo } from 'react';

import Desktop from './Desktop';
import Mobile from './Mobile';

interface ListLayoutProps extends PropsWithChildren {
  mobile?: boolean;
}

const ListLayout = memo<ListLayoutProps>(({ children, mobile }) => {
  if (mobile) {
    return <Mobile>{children}</Mobile>;
  }

  return <Desktop>{children}</Desktop>;
});

ListLayout.displayName = 'ListLayout';

export default ListLayout;
