'use client';

import { Navigate } from 'react-router-dom';

import { useAuthServerConfigStore } from '@/features/AuthShell';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

const SignUp = () => {
  const disableEmailPassword = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailPassword || false,
  );

  if (disableEmailPassword) return <Navigate replace to="/signin" />;

  return <BetterAuthSignUpForm />;
};

export default SignUp;
