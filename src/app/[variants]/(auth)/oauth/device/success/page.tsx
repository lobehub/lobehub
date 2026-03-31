import { notFound } from 'next/navigation';

import { authEnv } from '@/envs/auth';

import DeviceSuccess from './DeviceSuccess';

const DeviceSuccessPage = async () => {
  if (!authEnv.ENABLE_OIDC) return notFound();

  return <DeviceSuccess />;
};

export default DeviceSuccessPage;
