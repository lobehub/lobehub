'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from '@/libs/next/navigation';
import { memo } from 'react';

import ErrorCapture from '@/components/Error';

enum ErrorEnum {
  AccessDenied = 'AccessDenied',
  Configuration = 'Configuration',
  Default = 'Default',
  Verification = 'Verification',
}

const errorMap = {
  [ErrorEnum.Configuration]:
    'Wrong configuration, make sure you have the correct environment variables set. Visit https://lobehub.com/docs/self-hosting/advanced/authentication for more details.',
  [ErrorEnum.AccessDenied]:
    'Access was denied. Visit https://authjs.dev/reference/core/errors#accessdenied for more details. ',
  [ErrorEnum.Verification]:
    'Verification error, visit https://authjs.dev/reference/core/errors#verification for more details.',
  [ErrorEnum.Default]:
    'There was a problem when trying to authenticate. Visit https://authjs.dev/reference/core/errors for more details.',
};

export default memo(() => {
  const search = useSearchParams();
  const error = search.get('error') as ErrorEnum;
  const props = {
    error: {
      cause: error,
      message: errorMap[error] || 'Unknown error type.',
      name: 'NextAuth Error',
    },
    reset: () => signIn(undefined, { callbackUrl: '/' }),
  };
  console.log('[NextAuth] Error:', props.error);
  return <ErrorCapture {...props} />;
});
