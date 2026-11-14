'use client';

import { Avatar, Button, Flexbox, FluentEmoji, Result, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type MarketAuthAccount,
  persistMarketAuthResult,
  resolveMarketAuthAccountPayload,
} from '@/layout/AuthProvider/MarketAuth/handoff';

type CallbackStatus = 'loading' | 'success' | 'error';

const styles = stylex.create({
  account: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 260,
    paddingBlock: 12,
    paddingInline: 16,
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: cssVar.borderRadiusLG,
  },
  successIcon: {
    color: cssVar.colorSuccess,
  },
});

const MarketAuthCallbackPage = () => {
  const { t } = useTranslation('marketAuth');
  const [status, setStatus] = useState<CallbackStatus>('loading');
  const [message, setMessage] = useState('');
  const [authState, setAuthState] = useState<string>();
  const [account, setAccount] = useState<MarketAuthAccount>();

  useEffect(() => {
    console.info('[MarketAuthCallback] Processing authorization callback');

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    if (error) {
      console.error('[MarketAuthCallback] Authorization error:', error, errorDescription);
      setStatus('error');
      setMessage(t('callback.messages.authFailed', { error: errorDescription || error }));

      persistMarketAuthResult({
        error: errorDescription || error,
        state: state || undefined,
        type: 'MARKET_AUTH_ERROR',
      });

      // Send error message to parent window
      if (window.opener) {
        window.opener.postMessage(
          {
            error: errorDescription || error,
            state,
            type: 'MARKET_AUTH_ERROR',
          },
          window.location.origin,
        );
      }
      return;
    }

    if (code && state) {
      console.info('[MarketAuthCallback] Authorization successful, code received');
      setStatus('success');
      setAuthState(state);
      setMessage(t('callback.messages.successDescription'));

      persistMarketAuthResult({
        code,
        state,
        type: 'MARKET_AUTH_SUCCESS',
      });

      // Send success message to parent window
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

      return;
    }

    console.error('[MarketAuthCallback] Missing code or state parameter');
    setStatus('error');
    setMessage(t('callback.messages.missingParams'));

    persistMarketAuthResult({
      error: 'Missing authorization parameters',
      state: state || undefined,
      type: 'MARKET_AUTH_ERROR',
    });

    if (window.opener) {
      window.opener.postMessage(
        {
          error: 'Missing authorization parameters',
          state,
          type: 'MARKET_AUTH_ERROR',
        },
        window.location.origin,
      );
    }
  }, [t]);

  // The opener exchanges the code and knows who just authorized, so it posts the
  // account back here — the callback URL itself only carries code + state.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const payload = resolveMarketAuthAccountPayload(event.data);
      if (!payload) return;
      if (payload.state && authState && payload.state !== authState) return;

      setAccount(payload.account);
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [authState]);

  const getStatusIcon = () => {
    switch (status) {
      case 'success': {
        return <CircleCheck size={56} strokeWidth={1.5} {...stylex.props(styles.successIcon)} />;
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

    return message;
  };

  const getExtra = () => {
    if (status === 'loading') return undefined;

    return (
      <Flexbox align={'center'} gap={16}>
        {status === 'success' && account && (
          <div {...stylex.props(styles.account)}>
            <Avatar
              avatar={account.avatarUrl}
              fallbackVariant={'text'}
              size={40}
              title={account.displayName}
            />
            <Flexbox gap={2}>
              <Text weight={500}>{account.displayName}</Text>
              <Text fontSize={12} type={'secondary'}>
                {account.userName
                  ? `@${account.userName} · ${t('callback.messages.connectedAccount')}`
                  : t('callback.messages.connectedAccount')}
              </Text>
            </Flexbox>
          </div>
        )}
        <Button size={'large'} type={'primary'} onClick={() => window.close()}>
          {t('callback.buttons.close')}
        </Button>
      </Flexbox>
    );
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
