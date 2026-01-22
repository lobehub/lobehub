import { isDesktop } from '@lobechat/const';
import { type PropsWithChildren } from 'react';

import { authEnv } from '@/envs/auth';

import BetterAuth from './BetterAuth';
import Desktop from './Desktop';
import NextAuth from './NextAuth';
import NoAuth from './NoAuth';

const AuthProvider = ({ children }: PropsWithChildren) => {
  if (isDesktop) {
    return <Desktop>{children}</Desktop>;
  }

  if (authEnv.NEXT_PUBLIC_ENABLE_BETTER_AUTH) {
    return <BetterAuth>{children}</BetterAuth>;
  }

  if (authEnv.NEXT_PUBLIC_ENABLE_NEXT_AUTH) {
    return <NextAuth>{children}</NextAuth>;
  }

  return <NoAuth>{children}</NoAuth>;
};

export default AuthProvider;
