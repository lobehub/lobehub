import { lambdaClient } from '@/libs/trpc/client';

class ScmService {
  /** Redeem the single-use claim the install callback handed to the page. */
  connectInstallation = async (params: { claim: string }) =>
    lambdaClient.scm.connectInstallation.mutate(params);

  disconnectIdentity = async (provider: 'github') =>
    lambdaClient.scm.disconnectIdentity.mutate({ provider });

  getConfig = async () => lambdaClient.scm.getConfig.query();

  getIdentity = async (provider: 'github') => lambdaClient.scm.getIdentity.query({ provider });

  getRequesterCredentialPolicy = async () => lambdaClient.scm.getRequesterCredentialPolicy.query();

  hasWakeTarget = async (topicId: string) => lambdaClient.scm.hasWakeTarget.query({ topicId });

  listChangeRequests = async (params?: { limit?: number }) =>
    lambdaClient.scm.listChangeRequests.query(params);

  listCredentialGrants = async (params: {
    before?: Date;
    limit?: number;
    repo?: string;
    requesterUserId?: string;
  }) => lambdaClient.scm.listCredentialGrants.query(params);

  listInstallations = async () => lambdaClient.scm.listInstallations.query();

  listRepositories = async () => lambdaClient.scm.listRepositories.query();

  updateRequesterCredentialPolicy = async (enabled: boolean) =>
    lambdaClient.scm.updateRequesterCredentialPolicy.mutate({ enabled });
}

export const scmService = new ScmService();
