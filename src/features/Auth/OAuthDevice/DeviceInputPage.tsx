'use client';

import { memo } from 'react';
import { useSearchParams } from 'react-router';

import OAuthGuard from '../OAuthGuard';
import DeviceCodeInput from './DeviceCodeInput';

export const getDeviceErrorKey = (error?: string | null): string | undefined => {
  if (!error) return undefined;

  const errorMap: Record<string, string> = {
    'already been used': 'device.error.alreadyUsed',
    'code has expired': 'device.error.expired',
    'code was not found': 'device.error.notFound',
    'interaction was aborted': 'device.error.aborted',
    'no code': 'device.error.noCode',
  };

  for (const [key, i18nKey] of Object.entries(errorMap)) {
    if (error.toLowerCase().includes(key)) return i18nKey;
  }

  return 'device.error.unknown';
};

const DeviceInputPage = memo(() => {
  const [searchParams] = useSearchParams();

  return (
    <OAuthGuard>
      <DeviceCodeInput
        errorKey={getDeviceErrorKey(searchParams.get('error'))}
        userCode={searchParams.get('user_code') ?? undefined}
        xsrf={searchParams.get('xsrf') ?? undefined}
      />
    </OAuthGuard>
  );
});

DeviceInputPage.displayName = 'DeviceInputPage';

export default DeviceInputPage;
