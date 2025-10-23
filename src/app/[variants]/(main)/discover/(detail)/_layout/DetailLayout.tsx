'use client';

import { PropsWithChildren, memo } from 'react';

import Desktop from './Desktop';
import Mobile from './Mobile';

interface DetailLayoutProps extends PropsWithChildren {
  mobile?: boolean;
}

const DetailLayout = memo<DetailLayoutProps>(({ children, mobile }) => {
  if (mobile) {
    return <Mobile>{children}</Mobile>;
  }

  return <Desktop>{children}</Desktop>;
});

DetailLayout.displayName = 'DetailLayout';

export default DetailLayout;
