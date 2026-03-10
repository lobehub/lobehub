import { redirect } from 'next/navigation';
import { type PropsWithChildren } from 'react';

import { authEnv } from '@/envs/auth';

const ResetPasswordLayout = ({ children }: PropsWithChildren) => {
  if (authEnv.AUTH_DISABLE_EMAIL_PASSWORD) {
    redirect('/signin');
  }

  return children;
};

export default ResetPasswordLayout;
