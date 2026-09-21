import { lambdaClient } from '@/libs/trpc/client';

class ScmService {
  connectInstallation = async (params: { installationId: string; provider: 'github' }) =>
    lambdaClient.scm.connectInstallation.mutate(params);

  getConfig = async () => lambdaClient.scm.getConfig.query();

  getIdentity = async (provider: 'github') => lambdaClient.scm.getIdentity.query({ provider });

  listChangeRequests = async (params?: { limit?: number }) =>
    lambdaClient.scm.listChangeRequests.query(params);

  listInstallations = async () => lambdaClient.scm.listInstallations.query();
}

export const scmService = new ScmService();
