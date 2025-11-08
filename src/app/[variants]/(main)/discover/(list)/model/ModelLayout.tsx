'use client';

import { PropsWithChildren, memo } from 'react';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';

interface ModelLayoutProps extends PropsWithChildren {
  mobile?: boolean;
}

const ModelLayout = memo<ModelLayoutProps>(({ children, mobile }) => {
  if (mobile) {
    return <Mobile>{children}</Mobile>;
  }
  return <Desktop>{children}</Desktop>;
});

ModelLayout.displayName = 'ModelLayout';

export default ModelLayout;
