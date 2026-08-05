'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import React, { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';
import type { OidcClientMetadata } from '@/types/oidc';

import OAuthApplicationLogo from '../OAuthApplicationLogo';
import ThirdPartyNotice from '../ThirdPartyNotice';
import BuiltinConsent from './BuiltinConsent';

interface ClientProps {
  clientId: string;
  clientMetadata: OidcClientMetadata;
  redirectUri?: string;
  scopes: string[];
  uid: string;
}

/**
 * Get the description for a scope
 */
function getScopeDescription(scope: string, t: any): string {
  return t(`consent.scope.${scope.replace(':', '-')}`, scope);
}

const BUILTIN_CLIENTS = new Set(['lobehub-desktop', 'lobehub-mobile', 'lobehub-market']);

const ConsentClient = memo<ClientProps>(({ uid, clientId, scopes, clientMetadata }) => {
  const { t } = useTranslation('oauth');

  const [isLoading, setIsLoading] = useState(false);
  const consentInputRef = useRef<HTMLInputElement>(null);

  const clientDisplayName = clientMetadata?.clientName || clientId;

  if (BUILTIN_CLIENTS.has(clientId)) {
    return <BuiltinConsent uid={uid} />;
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
            <input defaultValue="accept" name="consent" ref={consentInputRef} type="hidden" />
            <Flexbox gap={12}>
              <Button
                data-testid="oauth-consent-accept"
                htmlType="submit"
                loading={isLoading}
                size={'large'}
                type="primary"
                onClick={() => {
                  if (consentInputRef.current) consentInputRef.current.value = 'accept';
                  setIsLoading(true);
                }}
              >
                {t('consent.buttons.accept')}
              </Button>
              <Button
                data-testid="oauth-consent-deny"
                htmlType="submit"
                size={'large'}
                onClick={() => {
                  if (consentInputRef.current) consentInputRef.current.value = 'deny';
                }}
              >
                {t('consent.buttons.deny')}
              </Button>
            </Flexbox>
          </form>
        }
      >
        {clientMetadata.isFirstParty === false && (
          <Flexbox style={{ marginBottom: 16 }}>
            <ThirdPartyNotice
              developerName={clientMetadata.developerName}
              policyUri={clientMetadata.policyUri}
            />
          </Flexbox>
        )}
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
