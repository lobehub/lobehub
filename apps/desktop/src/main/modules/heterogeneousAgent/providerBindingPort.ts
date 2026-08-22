import type {
  HeterogeneousProviderBindingReference,
  HeterogeneousProviderBindingRuntime,
} from '@lobechat/heterogeneous-agents';

import {
  callLambdaMutation,
  type RemoteServerAuth,
} from '@/modules/heterogeneousAgent/fileStorePort';

export const getProviderBindingRuntime = async (
  auth: RemoteServerAuth,
  reference: HeterogeneousProviderBindingReference,
): Promise<HeterogeneousProviderBindingRuntime> => {
  const serverUrl = await auth.getServerUrl();
  const accessToken = await auth.getAccessToken();
  if (!serverUrl || !accessToken) {
    throw new Error('LobeHub Provider binding requires an authenticated Desktop session.');
  }

  return callLambdaMutation<HeterogeneousProviderBindingRuntime>(
    { accessToken, serverUrl },
    'aiProvider.getProviderBindingRuntime',
    { id: reference.apiConfig.providerId },
  );
};
