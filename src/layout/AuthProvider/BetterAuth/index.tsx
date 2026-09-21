import { type PropsWithChildren } from 'react';

import UserUpdater from './UserUpdater';

const BetterAuth = ({ children }: PropsWithChildren) => {
  return <UserUpdater>{children}</UserUpdater>;
};

export default BetterAuth;
