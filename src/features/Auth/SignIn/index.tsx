'use client';

import { SignInEmailSentStep } from './SignInEmailSentStep';
import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { SignInPhoneStep } from './SignInPhoneStep';
import { useSignIn } from './useSignIn';

const SignIn = () => {
  const {
    disableEmailPassword,
    email,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handleGoToPhone,
    handleGoToSignup,
    handleResendEmail,
    handleResendPhoneOtp,
    handleSendPhoneOtp,
    handleSignIn,
    handleSocialSignIn,
    handleVerifyPhoneOtp,
    isSocialOnly,
    loading,
    oAuthSSOProviders,
    otpForm,
    phoneDisplay,
    phoneForm,
    resending,
    sending,
    sentInfo,
    serverConfigInit,
    socialLoading,
    step,
  } = useSignIn();

  if (step === 'emailSent' && sentInfo)
    return (
      <SignInEmailSentStep
        email={sentInfo.email}
        sending={sending}
        type={sentInfo.type}
        onBack={handleBackFromSent}
        onResend={handleResendEmail}
      />
    );

  if (step === 'phone' || step === 'phoneOtp')
    return (
      <SignInPhoneStep
        loading={loading}
        otpForm={otpForm}
        phoneDisplay={phoneDisplay}
        phoneForm={phoneForm}
        resending={resending}
        step={step}
        onBackToEmail={handleBackToEmail}
        onResend={handleResendPhoneOtp}
        onSendOtp={handleSendPhoneOtp}
        onVerifyOtp={handleVerifyPhoneOtp}
      />
    );

  if (step === 'password')
    return (
      <SignInPasswordStep
        email={email}
        forgotLoading={sending}
        form={form as any}
        loading={loading}
        onBackToEmail={handleBackToEmail}
        onForgotPassword={handleForgotPassword}
        onSubmit={handleSignIn}
      />
    );

  return (
    <SignInEmailStep
      disableEmailPassword={disableEmailPassword}
      form={form as any}
      isSocialOnly={isSocialOnly}
      loading={loading}
      oAuthSSOProviders={oAuthSSOProviders}
      serverConfigInit={serverConfigInit}
      socialLoading={socialLoading}
      onCheckUser={handleCheckUser}
      onGoToPhone={handleGoToPhone}
      onGoToSignup={handleGoToSignup}
      onResetEmail={handleBackToEmail}
      onSetPassword={handleForgotPassword}
      onSocialSignIn={handleSocialSignIn}
    />
  );
};

export default SignIn;
