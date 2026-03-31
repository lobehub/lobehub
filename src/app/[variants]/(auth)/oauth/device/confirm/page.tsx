import { notFound } from 'next/navigation';

import { authEnv } from '@/envs/auth';

import DeviceCodeConfirm from './DeviceCodeConfirm';

const DeviceConfirmPage = async (props: {
  searchParams: Promise<{
    client_id?: string;
    client_name?: string;
    user_code?: string;
    xsrf?: string;
  }>;
}) => {
  if (!authEnv.ENABLE_OIDC) return notFound();

  const searchParams = await props.searchParams;

  if (!searchParams.user_code) return notFound();

  return (
    <DeviceCodeConfirm
      clientName={searchParams.client_name || searchParams.client_id || 'Unknown Application'}
      userCode={searchParams.user_code}
      xsrf={searchParams.xsrf}
    />
  );
};

export default DeviceConfirmPage;
