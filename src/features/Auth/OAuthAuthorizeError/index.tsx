'use client';

import { Block, Flexbox, FluentEmoji } from '@lobehub/ui';
import { Button, Result, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

const REASON_KEYS = {
  access_denied: 'authorizeError.reason.access_denied',
  invalid_client: 'authorizeError.reason.invalid_client',
  invalid_redirect_uri: 'authorizeError.reason.invalid_redirect_uri',
  invalid_request: 'authorizeError.reason.invalid_request',
  invalid_scope: 'authorizeError.reason.invalid_scope',
  server_error: 'authorizeError.reason.server_error',
  unauthorized_client: 'authorizeError.reason.unauthorized_client',
} as const;

const isKnownError = (code: string | null): code is keyof typeof REASON_KEYS =>
  !!code && Object.prototype.hasOwnProperty.call(REASON_KEYS, code);

/**
 * Where the OIDC provider sends the browser when an authorization request
 * cannot continue (unregistered redirect URI, unknown client, bad parameters).
 * The provider never redirects back to the requesting app in these cases, so
 * this page is the user's only explanation of what happened.
 */
const OAuthAuthorizeError = memo(() => {
  const { t } = useTranslation('oauth');
  const [searchParams] = useSearchParams();

  const error = searchParams.get('error');
  const description = searchParams.get('error_description');
  const reason = isKnownError(error) ? t(REASON_KEYS[error]) : t('authorizeError.reason.unknown');

  const codeStyle = { fontFamily: cssVar.fontFamilyCode, fontSize: 12, wordBreak: 'break-word' };

  return (
    <Result
      icon={<FluentEmoji emoji={'🥵'} size={96} type={'anim'} />}
      status={'error'}
      extra={
        <a href="/">
          <Button block size={'large'} style={{ minWidth: 240 }}>
            {t('authorizeError.backToHome')}
          </Button>
        </a>
      }
      subTitle={
        <Flexbox align={'center'} gap={16} style={{ marginInline: 'auto', maxWidth: 440 }}>
          <Text fontSize={16} type={'secondary'}>
            {reason}
          </Text>
          {(error || description) && (
            <Block
              gap={6}
              padding={12}
              style={{ textAlign: 'start', width: '100%' }}
              variant={'filled'}
            >
              {error && (
                <Text style={codeStyle as any} type={'secondary'}>
                  {t('authorizeError.code')}: {error}
                </Text>
              )}
              {description && (
                <Text style={codeStyle as any} type={'secondary'}>
                  {description}
                </Text>
              )}
            </Block>
          )}
        </Flexbox>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {t('authorizeError.title')}
        </Text>
      }
    />
  );
});

OAuthAuthorizeError.displayName = 'OAuthAuthorizeError';

export default OAuthAuthorizeError;
