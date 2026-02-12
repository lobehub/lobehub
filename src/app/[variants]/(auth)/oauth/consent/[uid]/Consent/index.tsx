'use client';

import { Block, Button, Flexbox, Text } from '@lobehub/ui';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

import OAuthApplicationLogo from '../components/OAuthApplicationLogo';
import BuiltinConsent from './BuiltinConsent';

interface ClientProps {
  clientId: string;
  clientMetadata: {
    clientName?: string;
    isFirstParty?: boolean;
    logo?: string;
  };

  redirectUri?: string;
  scopes: string[];
  uid: string;
}

/**
 * 获取 Scope 的描述
 */
function getScopeDescription(scope: string, t: any): string {
  return t(`consent.scope.${scope.replace(':', '-')}`, scope);
}

const BUILTIN_CLIENTS = new Set(['lobehub-desktop', 'lobehub-mobile', 'lobehub-market']);

const ConsentClient = memo<ClientProps>(({ uid, clientId, scopes, clientMetadata }) => {
  const { t } = useTranslation('oauth');

  const [isLoading, setIsLoading] = useState(false);

  const clientDisplayName = clientMetadata?.clientName || clientId;

  if (BUILTIN_CLIENTS.has(clientId)) {
    return <BuiltinConsent uid={clientId} />;
  }

  return (
    <Flexbox gap={16} width={'min(100%,400px)'}>
      <OAuthApplicationLogo
        clientDisplayName={clientDisplayName}
        isFirstParty={clientMetadata.isFirstParty}
        logoUrl={clientMetadata.logo}
      />
      <AuthCard
        subtitle={t('consent.description', { clientName: clientDisplayName })}
        title={t('consent.title', { clientName: clientDisplayName })}
        footer={
          <form action="/oidc/consent" method="post" style={{ width: '100%' }}>
            <input name="uid" type="hidden" value={uid} />
            <Flexbox gap={12}>
              <Button
                htmlType="submit"
                loading={isLoading}
                name="consent"
                size={'large'}
                type="primary"
                value="accept"
                onClick={() => {
                  setIsLoading(true);
                }}
              >
                {t('consent.buttons.accept')}
              </Button>
              <Button htmlType="submit" name="consent" size={'large'} value="deny">
                {t('consent.buttons.deny')}
              </Button>
            </Flexbox>
          </form>
        }
      >
        <Text fontSize={16} type={'secondary'}>
          {t('consent.permissionsTitle')}
        </Text>
        <Flexbox gap={4} style={{ marginTop: 8 }} width={'100%'}>
          {scopes.map((scope) => (
            <Block key={scope} padding={16} variant={'filled'}>
              <Text>{getScopeDescription(scope, t)}</Text>
            </Block>
          ))}
        </Flexbox>
      </AuthCard>
    </Flexbox>
  );
});

ConsentClient.displayName = 'ConsentClient';

export default ConsentClient;
