'use client';

import { redirect } from 'next/navigation';
import { type PropsWithChildren } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

const ResetPasswordLayout = ({ children }: PropsWithChildren) => {
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);

  if (disableEmailPassword) {
    redirect('/signin');
  }

  return children;
};

export default ResetPasswordLayout;
