import { notFound } from '@/libs/next/navigation';
import { type PropsWithChildren } from 'react';

import { enableBetterAuth } from '@/envs/auth';

const Layout = ({ children }: PropsWithChildren) => {
  if (!enableBetterAuth) return notFound();

  return children;
};

export default Layout;
