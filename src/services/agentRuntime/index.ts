import { lambdaClient } from '@/libs/trpc/client';
import { type HumanInterventionRequest } from '@/services/agentRuntime/type';

export { agentRuntimeClient } from './client';
export * from './type';

class AgentRuntimeService {
  /**
   * Handle human intervention
   */
  async handleHumanIntervention(request: HumanInterventionRequest): Promise<any> {
    return await lambdaClient.aiAgent.processHumanIntervention.mutate({
      action: request.action,
      data: request.data,
      operationId: request.operationId,
      reason: request.reason,
      stepIndex: 0, // Default to 0 since it's not provided in the request type
    });
  }
}

export const agentRuntimeService = new AgentRuntimeService();
