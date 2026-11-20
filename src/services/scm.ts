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

  /** Turn a tracked pull request's Auto-fix on or off; back on starts the wake count over. */
  setChangeRequestAutoFix = async (params: { changeRequestId: string; enabled: boolean }) =>
    lambdaClient.scm.setChangeRequestAutoFix.mutate(params);
}

export const scmService = new ScmService();
