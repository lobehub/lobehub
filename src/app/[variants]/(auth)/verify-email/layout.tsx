import { notFound } from 'next/navigation';
import { type PropsWithChildren } from 'react';

import { enableBetterAuth } from '@/const/auth';

const Layout = ({ children }: PropsWithChildren) => {
  if (!enableBetterAuth) return notFound();

  return children;
};

export default Layout;
