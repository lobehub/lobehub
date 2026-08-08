'use client';

import { memo } from 'react';
import { useSearchParams } from 'react-router';

import NotFound from '@/components/404';

import { useClientMetadata } from '../OAuthConsent/useClientMetadata';
import OAuthGuard from '../OAuthGuard';
import DeviceCodeConfirm from './DeviceCodeConfirm';

const DeviceConfirmPage = memo(() => {
  const [searchParams] = useSearchParams();

  const userCode = searchParams.get('user_code');
  const clientId = searchParams.get('client_id') ?? undefined;

  const { data: clientMetadata } = useClientMetadata(clientId);

  return (
    <OAuthGuard>
      {userCode ? (
        <DeviceCodeConfirm
          developerName={clientMetadata?.developerName}
          isFirstParty={clientMetadata?.isFirstParty}
          policyUri={clientMetadata?.policyUri}
          userCode={userCode}
          xsrf={searchParams.get('xsrf') ?? undefined}
          clientName={
            clientMetadata?.clientName ||
            searchParams.get('client_name') ||
            clientId ||
            'Unknown Application'
          }
        />
      ) : (
        <NotFound />
      )}
    </OAuthGuard>
  );
});

DeviceConfirmPage.displayName = 'DeviceConfirmPage';

export default DeviceConfirmPage;
