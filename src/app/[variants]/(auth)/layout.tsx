import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type {FC, PropsWithChildren} from 'react';

import ClientOnly from '@/components/client/ClientOnly';

import AuthContainer from './_layout';

const AuthLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ClientOnly>
      <NuqsAdapter>
        <AuthContainer>{children}</AuthContainer>
      </NuqsAdapter>
    </ClientOnly>
  );
};

export default AuthLayout;
