import { lambdaClient } from '@/libs/trpc/client';

class AgentLikeService {
  like = (agentId: string) => lambdaClient.agentLike.like.mutate({ agentId });

  summaries = () => lambdaClient.agentLike.summaries.query();

  unlike = (agentId: string) => lambdaClient.agentLike.unlike.mutate({ agentId });
}

export const agentLikeService = new AgentLikeService();
