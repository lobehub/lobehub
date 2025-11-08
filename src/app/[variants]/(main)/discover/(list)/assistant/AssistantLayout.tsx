'use client';

import { PropsWithChildren, memo } from 'react';

import Desktop from './_layout/Desktop';
import Mobile from './_layout/Mobile';

interface AssistantLayoutProps extends PropsWithChildren {
  mobile?: boolean;
}

const AssistantLayout = memo<AssistantLayoutProps>(({ children, mobile }) => {
  if (mobile) {
    return <Mobile>{children}</Mobile>;
  }
  return <Desktop>{children}</Desktop>;
});

AssistantLayout.displayName = 'AssistantLayout';

export default AssistantLayout;
