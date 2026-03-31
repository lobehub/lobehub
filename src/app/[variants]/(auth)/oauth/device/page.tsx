import { notFound } from 'next/navigation';

import { authEnv } from '@/envs/auth';

import DeviceCodeInput from './DeviceCodeInput';

const getErrorMessage = (error?: string): string | undefined => {
  if (!error) return undefined;

  const errorMap: Record<string, string> = {
    'already been used': 'device.error.alreadyUsed',
    'interaction was aborted': 'device.error.aborted',
    'code has expired': 'device.error.expired',
    'code was not found': 'device.error.notFound',
    'no code': 'device.error.noCode',
  };

  for (const [key, i18nKey] of Object.entries(errorMap)) {
    if (error.toLowerCase().includes(key)) return i18nKey;
  }

  return 'device.error.unknown';
};

const DeviceInputPage = async (props: {
  searchParams: Promise<{ error?: string; user_code?: string; xsrf?: string }>;
}) => {
  if (!authEnv.ENABLE_OIDC) return notFound();

  const searchParams = await props.searchParams;

  return (
    <DeviceCodeInput
      errorKey={getErrorMessage(searchParams.error)}
      userCode={searchParams.user_code}
      xsrf={searchParams.xsrf}
    />
  );
};

export default DeviceInputPage;
