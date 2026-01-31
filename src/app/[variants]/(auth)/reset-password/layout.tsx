'use client';

import { type PropsWithChildren, useEffect } from 'react';

import { useRouter } from '@/libs/next/navigation';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

const ResetPasswordLayout = ({ children }: PropsWithChildren) => {
  const router = useRouter();
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);

  useEffect(() => {
    if (disableEmailPassword) {
      router.replace('/signin');
    }
  }, [disableEmailPassword, router]);

  if (disableEmailPassword) {
    return null;
  }

  return children;
};

export default ResetPasswordLayout;
