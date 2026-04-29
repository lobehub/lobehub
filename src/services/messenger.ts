import { lambdaClient } from '@/libs/trpc/client';

type MessengerPlatform = 'telegram' | 'slack';

class MessengerService {
  availablePlatforms = async () => {
    return lambdaClient.messenger.availablePlatforms.query();
  };

  peekLinkToken = async (randomId: string) => {
    return lambdaClient.messenger.peekLinkToken.query({ randomId });
  };

  confirmLink = async (params: { initialAgentId: string; randomId: string }) => {
    return lambdaClient.messenger.confirmLink.mutate(params);
  };

  getMyLink = async (platform: MessengerPlatform) => {
    return lambdaClient.messenger.getMyLink.query({ platform });
  };

  listMyLinks = async () => {
    return lambdaClient.messenger.listMyLinks.query();
  };

  setActiveAgent = async (params: { agentId: string | null; platform: MessengerPlatform }) => {
    return lambdaClient.messenger.setActiveAgent.mutate(params);
  };

  unlink = async (params: { platform: MessengerPlatform }) => {
    return lambdaClient.messenger.unlink.mutate(params);
  };
}

export const messengerService = new MessengerService();
