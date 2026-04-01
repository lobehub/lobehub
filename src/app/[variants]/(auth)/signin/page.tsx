'use client';

import { Button, Icon } from '@lobehub/ui';
import { Smartphone, UserRound } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';

import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { SignInPhoneStep } from './SignInPhoneStep';
import { useSignIn } from './useSignIn';

const SignInPage = () => {
  const { t } = useTranslation('auth');
  const [isMounted, setIsMounted] = useState(false);
  const secondaryTextStyle = {
    color: 'var(--ant-color-text-secondary)',
  } as const;
  const secondaryLinkStyle = {
    color: 'var(--ant-color-text-secondary)',
    cursor: 'pointer',
    textDecoration: 'none',
  } as const;
  const {
    disableEmailPassword,
    enablePhoneAuth,
    email,
    form,
    handleBackToEmail,
    handleCheckUser,
    handleForgotPassword,
    handlePhonePasswordSignIn,
    handleResetPhoneInput,
    handleSignIn,
    handleSocialSignIn,
    handleSendPhoneCode,
    handleUsePhoneCode,
    handleUsePhonePassword,
    handleVerifyPhoneCode,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    phone,
    phoneCooldown,
    phoneForm,
    phoneHasPassword,
    phoneMode,
    serverConfigInit,
    socialLoading,
    step,
  } = useSignIn();
  const isPhoneStep = enablePhoneAuth && step === 'phone';
  const showModeSwitch = isMounted && enablePhoneAuth && !disableEmailPassword;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const action =
    phoneMode === 'password' ? (
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <a style={secondaryLinkStyle} onClick={handleResetPhoneInput}>
          {t('betterAuth.signin.changePhone')}
        </a>
        <a style={secondaryLinkStyle} onClick={handleUsePhoneCode}>
          {t('betterAuth.signin.usePhoneCode')}
        </a>
      </div>
    ) : phoneMode === 'verify' ? (
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <a style={secondaryLinkStyle} onClick={handleResetPhoneInput}>
          {t('betterAuth.signin.changePhone')}
        </a>
        {phoneHasPassword && (
          <a style={secondaryLinkStyle} onClick={handleUsePhonePassword}>
            {t('betterAuth.signin.usePhonePassword')}
          </a>
        )}
      </div>
    ) : null;

  const renderModeSwitch = (active: 'email' | 'phone') => {
    if (!showModeSwitch) return null;

    return (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            background: 'var(--ant-color-fill-quaternary)',
            border: '1px solid var(--ant-color-border-secondary)',
            borderRadius: 999,
            display: 'inline-flex',
            gap: 6,
            padding: 4,
          }}
        >
          <Button
            color={active === 'email' ? 'primary' : 'default'}
            icon={<Icon icon={UserRound} />}
            size={'small'}
            style={active === 'email' ? undefined : secondaryTextStyle}
            variant={active === 'email' ? 'filled' : 'text'}
            onClick={handleBackToEmail}
          >
            {t('betterAuth.signin.useEmailOrUsername')}
          </Button>
          <Button
            color={active === 'phone' ? 'primary' : 'default'}
            icon={<Icon icon={Smartphone} />}
            size={'small'}
            style={active === 'phone' ? undefined : secondaryTextStyle}
            variant={active === 'phone' ? 'filled' : 'text'}
            onClick={handleResetPhoneInput}
          >
            {t('betterAuth.signin.usePhone')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Suspense fallback={<Loading debugId={'Signin'} />}>
      {isPhoneStep ? (
        <SignInPhoneStep
          action={action}
          cooldown={phoneCooldown}
          form={phoneForm as any}
          loading={loading}
          mode={phoneMode}
          modeSwitch={renderModeSwitch('phone')}
          phone={phone}
          showBackLink={false}
          submitInputText={t('betterAuth.signin.sendCode')}
          onBackToEmail={handleBackToEmail}
          onSendCode={handleSendPhoneCode}
          onSubmitCode={handleVerifyPhoneCode}
          onSubmitPassword={handlePhonePasswordSignIn}
        />
      ) : step === 'password' ? (
        <SignInPasswordStep
          email={email}
          form={form as any}
          loading={loading}
          onBackToEmail={handleBackToEmail}
          onForgotPassword={handleForgotPassword}
          onSubmit={handleSignIn}
        />
      ) : (
        <SignInEmailStep
          disableEmailPassword={disableEmailPassword}
          form={form as any}
          isSocialOnly={isSocialOnly}
          lastAuthProvider={lastAuthProvider}
          loading={loading}
          modeSwitch={renderModeSwitch('email')}
          oAuthSSOProviders={oAuthSSOProviders}
          serverConfigInit={serverConfigInit}
          socialLoading={socialLoading}
          onCheckUser={handleCheckUser}
          onSetPassword={handleForgotPassword}
          onSocialSignIn={handleSocialSignIn}
        />
      )}
    </Suspense>
  );
};

export default SignInPage;
