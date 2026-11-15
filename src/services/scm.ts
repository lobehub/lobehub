import { lambdaClient } from '@/libs/trpc/client';

class ScmService {
  /** Redeem the single-use claim the install callback handed to the page. */
  connectInstallation = async (params: { claim: string }) =>
    lambdaClient.scm.connectInstallation.mutate(params);

  getConfig = async () => lambdaClient.scm.getConfig.query();

  getIdentity = async (provider: 'github') => lambdaClient.scm.getIdentity.query({ provider });

  hasWakeTarget = async (topicId: string) => lambdaClient.scm.hasWakeTarget.query({ topicId });

  listChangeRequests = async (params?: { limit?: number }) =>
    lambdaClient.scm.listChangeRequests.query(params);

  listInstallations = async () => lambdaClient.scm.listInstallations.query();

  listRepositories = async () => lambdaClient.scm.listRepositories.query();
}

export const scmService = new ScmService();
