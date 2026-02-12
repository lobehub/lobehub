import {
  type CreateAgentCronJobData,
  type UpdateAgentCronJobData,
} from '@/database/schemas/agentCronJob';
import { lambdaClient } from '@/libs/trpc/client/lambda';

/**
 * Client-side service for Agent Cron Job operations
 *
 * This service provides a clean interface for frontend components
 * to interact with agent cron job data using tRPC client.
 */
class AgentCronJobService {
  /**
   * Create a new cron job
   */
  async create(data: Omit<CreateAgentCronJobData, 'userId'>) {
    return await lambdaClient.agentCronJob.create.mutate(data);
  }

  /**
   * Get cron jobs for a specific agent
   */
  async getByAgentId(agentId: string) {
    return await lambdaClient.agentCronJob.findByAgent.query({ agentId });
  }

  /**
   * Get a single cron job by ID
   */
  async getById(id: string) {
    return await lambdaClient.agentCronJob.findById.query({ id });
  }

  /**
   * List cron jobs with pagination and filtering
   */
  async list(
    options: {
      agentId?: string;
      enabled?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    return await lambdaClient.agentCronJob.list.query(options);
  }

  /**
   * Update a cron job
   */
  async update(id: string, data: UpdateAgentCronJobData) {
    return await lambdaClient.agentCronJob.update.mutate({ data, id });
  }

  /**
   * Delete a cron job
   */
  async delete(id: string) {
    return await lambdaClient.agentCronJob.delete.mutate({ id });
  }

  /**
   * Reset execution counts
   */
  async resetExecutions(id: string, newMaxExecutions?: number) {
    return await lambdaClient.agentCronJob.resetExecutions.mutate({
      id,
      newMaxExecutions,
    });
  }

  /**
   * Get execution statistics
   */
  async getStats() {
    return await lambdaClient.agentCronJob.getStats.query();
  }

  /**
   * Get jobs near depletion
   */
  async getNearDepletion(threshold: number = 5) {
    return await lambdaClient.agentCronJob.getNearDepletion.query({ threshold });
  }

  /**
   * Batch update status (enable/disable) for multiple jobs
   */
  async batchUpdateStatus(ids: string[], enabled: boolean) {
    return await lambdaClient.agentCronJob.batchUpdateStatus.mutate({ enabled, ids });
  }
}

export const agentCronJobService = new AgentCronJobService();
