import { lambdaClient } from '@/libs/trpc/client';

type LobeAIPlatform = 'telegram' | 'slack';

class LobeAIService {
  availablePlatforms = async () => {
    return lambdaClient.lobeAI.availablePlatforms.query();
  };

  peekLinkToken = async (randomId: string) => {
    return lambdaClient.lobeAI.peekLinkToken.query({ randomId });
  };

  confirmLink = async (params: { initialAgentId: string; randomId: string }) => {
    return lambdaClient.lobeAI.confirmLink.mutate(params);
  };

  getMyLink = async (platform: LobeAIPlatform) => {
    return lambdaClient.lobeAI.getMyLink.query({ platform });
  };

  listMyLinks = async () => {
    return lambdaClient.lobeAI.listMyLinks.query();
  };

  setActiveAgent = async (params: { agentId: string | null; platform: LobeAIPlatform }) => {
    return lambdaClient.lobeAI.setActiveAgent.mutate(params);
  };

  unlink = async (params: { platform: LobeAIPlatform }) => {
    return lambdaClient.lobeAI.unlink.mutate(params);
  };
}

export const lobeAIService = new LobeAIService();
