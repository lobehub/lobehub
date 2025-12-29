import { lambdaClient } from '@/libs/trpc/client';

export interface ExecAgentTaskParams {
  agentId?: string;
  appContext?: {
    groupId?: string | null;
    scope?: string | null;
    sessionId?: string;
    threadId?: string | null;
    topicId?: string | null;
  };
  autoStart?: boolean;
  existingMessageIds?: string[];
  prompt: string;
  slug?: string;
}

/**
 * Parameters for execSubAgentTask
 * Supports both Group mode (with groupId) and Single Agent mode (without groupId)
 */
export interface ExecSubAgentTaskParams {
  agentId: string;
  /** Optional for Single Agent mode, required for Group mode */
  groupId?: string;
  instruction: string;
  parentMessageId: string;
  timeout?: number;
  topicId: string;
}

export interface GetSubAgentTaskStatusParams {
  threadId: string;
}

export interface InterruptTaskParams {
  operationId?: string;
  threadId?: string;
}

class AiAgentService {
  /**
   * Execute a single Agent task
   */
  async execAgentTask(params: ExecAgentTaskParams) {
    return await lambdaClient.aiAgent.execAgent.mutate(params);
  }

  /**
   * Execute a sub-agent task (supports both Group and Single Agent mode)
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   */
  async execSubAgentTask(params: ExecSubAgentTaskParams) {
    return await lambdaClient.aiAgent.execSubAgentTask.mutate(params);
  }

  /**
   * Get SubAgent task status by threadId
   * Works for both Group and Single Agent mode tasks
   */
  async getSubAgentTaskStatus(params: GetSubAgentTaskStatusParams) {
    return await lambdaClient.aiAgent.getSubAgentTaskStatus.query(params);
  }

  /**
   * Interrupt a running task
   */
  async interruptTask(params: InterruptTaskParams) {
    return await lambdaClient.aiAgent.interruptTask.mutate(params);
  }
}

export const aiAgentService = new AiAgentService();
