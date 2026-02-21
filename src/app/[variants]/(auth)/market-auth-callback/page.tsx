'use client';

import { Button, FluentEmoji, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CallbackStatus = 'loading' | 'success' | 'error';

/**
 * Market OIDC 授权回调页面
 * 处理从 OIDC 服务器返回的授权码
 */
const MarketAuthCallbackPage = () => {
  const { t } = useTranslation('marketAuth');
  const [status, setStatus] = useState<CallbackStatus>('loading');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    console.log('[MarketAuthCallback] Processing authorization callback');

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    if (error) {
      console.error('[MarketAuthCallback] Authorization error:', error, errorDescription);
      setStatus('error');
      setMessage(t('callback.messages.authFailed', { error: errorDescription || error }));

      // 向父窗口发送错误消息
      if (window.opener) {
        window.opener.postMessage(
          {
            error: errorDescription || error,
            type: 'MARKET_AUTH_ERROR',
          },
          window.location.origin,
        );
      }
      return;
    }

    if (code && state) {
      console.log('[MarketAuthCallback] Authorization successful, code received');
      setStatus('success');
      setMessage(t('callback.messages.successWithRedirect'));

      // 向父窗口发送成功消息
      if (window.opener) {
        window.opener.postMessage(
          {
            code,
            state,
            type: 'MARKET_AUTH_SUCCESS',
          },
          window.location.origin,
        );
      }

      // 开始倒计时并在3秒后关闭窗口
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
    } else {
      console.error('[MarketAuthCallback] Missing code or state parameter');
      setStatus('error');
      setMessage(t('callback.messages.missingParams'));

      if (window.opener) {
        window.opener.postMessage(
          {
            error: 'Missing authorization parameters',
            type: 'MARKET_AUTH_ERROR',
          },
          window.location.origin,
        );
      }
    }
  }, [t]);

  const getStatusIcon = () => {
    switch (status) {
      case 'success': {
        return <FluentEmoji emoji={'✅'} size={96} type={'anim'} />;
      }
      case 'error': {
        return <FluentEmoji emoji={'🥵'} size={96} type={'anim'} />;
      }
      default: {
        return <FluentEmoji emoji={'⌛'} size={96} type={'anim'} />;
      }
    }
  };

  const getResultStatus = () => {
    switch (status) {
      case 'success': {
        return 'success';
      }
      case 'error': {
        return 'error';
      }
      default: {
        return 'info';
      }
    }
  };

  const getTitle = () => {
    switch (status) {
      case 'loading': {
        return t('callback.titles.loading');
      }
      case 'success': {
        return t('callback.titles.success');
      }
      case 'error': {
        return t('callback.titles.error');
      }
    }
  };

  const getSubTitle = () => {
    if (status === 'loading') {
      return t('callback.messages.processing');
    }
    if (status === 'success') {
      return t('callback.messages.successWithCountdown', { countdown, message });
    }
    return message;
  };

  const getExtra = () => {
    if (status === 'error') {
      return (
        <Button block size={'large'} style={{ minWidth: 240 }} onClick={() => window.close()}>
          {t('callback.buttons.close')}
        </Button>
      );
    }
    return undefined;
  };

  return (
    <Result
      extra={getExtra()}
      icon={getStatusIcon()}
      status={getResultStatus()}
      subTitle={
        <Text fontSize={16} type="secondary">
          {getSubTitle()}
        </Text>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {getTitle()}
        </Text>
      }
    />
  );
};

export default MarketAuthCallbackPage;
