'use client';

import { Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { useSignIn } from './useSignIn';

const SignInPage = () => {
  const {
    email,
    form,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleSignIn,
    handleSocialSignIn,
    loading,
    oAuthSSOProviders,
    serverConfigInit,
    socialLoading,
    step,
  } = useSignIn();

  return (
    <Suspense fallback={<Loading debugId={'Signin'} />}>
      {step === 'email' ? (
        <SignInEmailStep
          form={form as any}
          loading={loading}
          oAuthSSOProviders={oAuthSSOProviders}
          onCheckUser={handleCheckUser}
          onSocialSignIn={handleSocialSignIn}
          serverConfigInit={serverConfigInit}
          socialLoading={socialLoading}
        />
      ) : (
        <SignInPasswordStep
          email={email}
          form={form as any}
          loading={loading}
          onBackToEmail={handleBackToEmail}
          onForgotPassword={handleForgotPassword}
          onSubmit={handleSignIn}
        />
      )}
    </Suspense>
  );
};

export default SignInPage;
