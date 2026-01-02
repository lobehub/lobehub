import { type PropsWithChildren } from 'react';

import UserUpdater from './UserUpdater';

const BetterAuth = ({ children }: PropsWithChildren) => {
  return (
    <>
      {children}
      <UserUpdater />
    </>
  );
};

export default BetterAuth;
