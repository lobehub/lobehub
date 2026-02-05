'use client';

import { FluentEmoji, Text } from '@lobehub/ui';
import { Result } from 'antd';
import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSearchParams } from '@/libs/next/navigation';

const SuccessPage = memo(() => {
  const { t } = useTranslation('oauth');
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    // Check if this is a LobeHub Skill OAuth callback
    const provider = searchParams.get('provider');

    if (provider && window.opener) {
      // Notify parent window about successful OAuth
      window.opener.postMessage(
        {
          provider,
          type: 'LOBEHUB_SKILL_AUTH_SUCCESS',
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
  }, [searchParams]);

  const provider = searchParams.get('provider');

  return (
    <Result
      icon={<FluentEmoji emoji={'✅'} size={96} type={'anim'} />}
      status="success"
      subTitle={
        <Text fontSize={16} type="secondary">
          {provider
            ? t('success.subTitleWithCountdown', {
                countdown,
                defaultValue: `You may close this page. Auto-closing in ${countdown}s...`,
              })
            : t('success.subTitle')}
        </Text>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {t('success.title')}
        </Text>
      }
    />
  );
});

SuccessPage.displayName = 'SuccessPage';

export default SuccessPage;
