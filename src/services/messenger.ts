import { lambdaClient } from '@/libs/trpc/client';

type MessengerPlatform = 'telegram' | 'slack' | 'discord';

class MessengerService {
  availablePlatforms = async () => {
    return lambdaClient.messenger.availablePlatforms.query();
  };

  peekLinkToken = async (randomId: string) => {
    return lambdaClient.messenger.peekLinkToken.query({ randomId });
  };

  listAgentsForBinding = async () => {
    return lambdaClient.messenger.listAgentsForBinding.query();
  };

  confirmLink = async (params: { initialAgentId: string; randomId: string }) => {
    return lambdaClient.messenger.confirmLink.mutate(params);
  };

  getMyLink = async (platform: MessengerPlatform, tenantId?: string) => {
    return lambdaClient.messenger.getMyLink.query({ platform, tenantId });
  };

  listMyLinks = async () => {
    return lambdaClient.messenger.listMyLinks.query();
  };

  setActiveAgent = async (params: {
    agentId: string | null;
    platform: MessengerPlatform;
    tenantId?: string;
  }) => {
    return lambdaClient.messenger.setActiveAgent.mutate(params);
  };

  unlink = async (params: { platform: MessengerPlatform; tenantId?: string }) => {
    return lambdaClient.messenger.unlink.mutate(params);
  };

  listMyInstallations = async () => {
    return lambdaClient.messenger.listMyInstallations.query();
  };

  uninstallInstallation = async (params: { installationId: string }) => {
    return lambdaClient.messenger.uninstallInstallation.mutate(params);
  };
}

export const messengerService = new MessengerService();
