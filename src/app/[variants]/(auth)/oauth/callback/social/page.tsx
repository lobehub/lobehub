'use client';

import { FluentEmoji, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { useSearchParams } from 'next/navigation';
import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CallbackStatus = 'error' | 'success';

const SocialOAuthCallbackPage = memo(() => {
  const { t } = useTranslation('oauth');
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(3);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<CallbackStatus>('success');

  useEffect(() => {
    const provider = searchParams.get('provider');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      const message = errorDescription || error;

      setStatus('error');
      setErrorMessage(message);

      if (provider && window.opener) {
        window.opener.postMessage(
          {
            error: message,
            provider,
            type: 'SOCIAL_PROFILE_AUTH_ERROR',
          },
          window.location.origin,
        );
      }

      return;
    }

    if (provider && window.opener) {
      setStatus('success');
      setErrorMessage(null);

      // Notify parent window that callback has completed. Parent window will confirm the connection state.
      window.opener.postMessage(
        {
          provider,
          type: 'SOCIAL_PROFILE_AUTH_CALLBACK',
        },
        window.location.origin,
      );

      // Start countdown and close window after 3 seconds
      let timeLeft = 3;
      setCountdown(timeLeft);

      const countdownTimer = setInterval(() => {
        timeLeft -= 1;
        setCountdown(timeLeft);

        if (timeLeft <= 0) {
          clearInterval(countdownTimer);
          window.close();
        }
      }, 1000);

      return () => clearInterval(countdownTimer);
    }

    setStatus('error');
    setErrorMessage('Missing provider parameter');
  }, [searchParams]);

  const provider = searchParams.get('provider');

  return (
    <Result
      icon={<FluentEmoji emoji={status === 'success' ? '✅' : '🥵'} size={96} type={'anim'} />}
      status={status}
      subTitle={
        <Text fontSize={16} type="secondary">
          {status === 'success' && provider
            ? t('success.subTitleWithCountdown', {
                countdown,
                defaultValue: `You may close this page. Auto-closing in ${countdown}s...`,
              })
            : t('error.desc', {
                defaultValue: `OAuth authorization failed, reason: ${errorMessage}`,
                reason: errorMessage,
              })}
        </Text>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {status === 'success' ? t('success.title') : t('error.title')}
        </Text>
      }
    />
  );
});

SocialOAuthCallbackPage.displayName = 'SocialOAuthCallbackPage';

export default SocialOAuthCallbackPage;
