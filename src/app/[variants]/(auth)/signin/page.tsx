'use client';

import { Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { SignInPhoneStep } from './SignInPhoneStep';
import { useSignIn } from './useSignIn';

const SignInPage = () => {
  const {
    disableEmailPassword,
    enablePhoneAuth,
    email,
    form,
    handleSendPhoneCode,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleSignIn,
    handleSocialSignIn,
    handleVerifyPhoneCode,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    phone,
    phoneCooldown,
    phoneForm,
    phoneMode,
    serverConfigInit,
    socialLoading,
    step,
  } = useSignIn();

  return (
    <Suspense fallback={<Loading debugId={'Signin'} />}>
      {step === 'email' ? (
        <SignInEmailStep
          disableEmailPassword={disableEmailPassword}
          enablePhoneAuth={enablePhoneAuth}
          form={form as any}
          isSocialOnly={isSocialOnly}
          lastAuthProvider={lastAuthProvider}
          loading={loading}
          oAuthSSOProviders={oAuthSSOProviders}
          phoneForm={phoneForm as any}
          serverConfigInit={serverConfigInit}
          socialLoading={socialLoading}
          onCheckUser={handleCheckUser}
          onSendPhoneCode={handleSendPhoneCode}
          onSetPassword={handleForgotPassword}
          onSocialSignIn={handleSocialSignIn}
        />
      ) : step === 'phone' ? (
        <SignInPhoneStep
          cooldown={phoneCooldown}
          form={phoneForm as any}
          loading={loading}
          mode={phoneMode}
          phone={phone}
          onBackToEmail={handleBackToEmail}
          onSendCode={handleSendPhoneCode}
          onSubmitCode={handleVerifyPhoneCode}
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
