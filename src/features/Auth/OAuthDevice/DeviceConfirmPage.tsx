'use client';

import { memo } from 'react';
import { useSearchParams } from 'react-router';

import NotFound from '@/components/404';

import OAuthGuard from '../OAuthGuard';
import DeviceCodeConfirm from './DeviceCodeConfirm';

const DeviceConfirmPage = memo(() => {
  const [searchParams] = useSearchParams();

  const userCode = searchParams.get('user_code');

  return (
    <OAuthGuard>
      {userCode ? (
        <DeviceCodeConfirm
          userCode={userCode}
          xsrf={searchParams.get('xsrf') ?? undefined}
          clientName={
            searchParams.get('client_name') ||
            searchParams.get('client_id') ||
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
