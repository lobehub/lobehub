'use client';

import { Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { useSignIn } from './useSignIn';

const SignInPage = () => {
  const {
    disableEmailPassword,
    email,
    form,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleSignIn,
    handleSocialSignIn,
    isSocialOnly,
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
          disableEmailPassword={disableEmailPassword}
          form={form as any}
          isSocialOnly={isSocialOnly}
          loading={loading}
          oAuthSSOProviders={oAuthSSOProviders}
          serverConfigInit={serverConfigInit}
          socialLoading={socialLoading}
          onCheckUser={handleCheckUser}
          onSetPassword={handleForgotPassword}
          onSocialSignIn={handleSocialSignIn}
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
