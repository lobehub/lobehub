import { isDesktop } from '@lobechat/const';
import { type PropsWithChildren } from 'react';

import BetterAuth from './BetterAuth';
import Desktop from './Desktop';

const AuthProvider = ({ children }: PropsWithChildren) => {
  if (isDesktop) {
    return <Desktop>{children}</Desktop>;
  }

  // In SPA/Vite mode, always use BetterAuth.
  // If auth is not configured on the server, useSession() will return no session
  // and the user will be treated as not signed in — same effect as NoAuth.
  return <BetterAuth>{children}</BetterAuth>;
};

export default AuthProvider;
