import type {
  HeterogeneousProviderBindingReference,
  HeterogeneousProviderBindingRuntime,
  ServerDefaultHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';

import {
  callLambdaMutation,
  type RemoteServerAuth,
} from '@/modules/heterogeneousAgent/fileStorePort';

export const getProviderBindingRuntime = async (
  auth: RemoteServerAuth,
  reference: Extract<HeterogeneousProviderBindingReference, { kind: 'provider' }>,
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

export interface ServerDefaultOperationBinding {
  endpoint: string;
  model: 'lobehub-default';
  token: string;
}

const getAuthenticatedServer = async (auth: RemoteServerAuth) => {
  const serverUrl = await auth.getServerUrl();
  const accessToken = await auth.getAccessToken();
  if (!serverUrl || !accessToken) {
    throw new Error('Server-default execution requires an authenticated Desktop session.');
  }
  return { accessToken, serverUrl };
};

export const beginServerDefaultOperation = async (
  auth: RemoteServerAuth,
  input: {
    agentType: ServerDefaultHeterogeneousAgentType;
    agentId?: string;
    model: string;
    operationId: string;
    topicId: string;
  },
): Promise<ServerDefaultOperationBinding> => {
  const server = await getAuthenticatedServer(auth);
  const result = await callLambdaMutation<Omit<ServerDefaultOperationBinding, 'endpoint'>>(
    server,
    'aiAgent.beginServerDefaultHeterogeneousOperation',
    input,
  );
  return { ...result, endpoint: server.serverUrl.replace(/\/$/, '') };
};

export const getServerDefaultEndpoint = async (auth: RemoteServerAuth): Promise<string> =>
  (await getAuthenticatedServer(auth)).serverUrl.replace(/\/$/, '');

export const settleServerDefaultOperation = async (
  auth: RemoteServerAuth,
  input: { cancelled?: boolean; operationId: string; result?: 'done' | 'error' },
): Promise<void> => {
  const server = await getAuthenticatedServer(auth);
  await callLambdaMutation(
    server,
    input.cancelled
      ? 'aiAgent.cancelServerDefaultHeterogeneousOperation'
      : 'aiAgent.finishServerDefaultHeterogeneousOperation',
    input.cancelled
      ? { operationId: input.operationId }
      : { operationId: input.operationId, result: input.result ?? 'error' },
  );
};
