import type {
  ExecAgentAppContext,
  ExecAgentResult,
  RuntimeMentionedAgent,
  ScheduleAgentRunParams,
  ScheduleAgentRunResult,
  UserInterventionConfig,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export type { ExecAgentResult, ScheduleAgentRunParams, ScheduleAgentRunResult };

/**
 * Resume instruction for an operation that hit `human_approve_required`. When
 * present, the new op acts as the "continue" step: server reads the target tool
 * message, writes the user's decision, and either re-dispatches the tool
 * (approved) or feeds the rejection back to the LLM as user feedback
 * (rejected / rejected_continue).
 *
 * Kept as a top-level field (not folded into `appContext`) so the server schema
 * can validate it independently.
 */
export interface ResumeApprovalParam {
  decision: 'approved' | 'rejected' | 'rejected_continue';
  /** ID of the pending `role='tool'` message this decision targets. */
  parentMessageId: string;
  /** Optional user-supplied rejection reason (only meaningful for rejected variants). */
  rejectionReason?: string;
  /** tool_call_id of the pending tool call being approved/rejected. */
  toolCallId: string;
}

/**
 * Resume instruction for an operation that paused on a `humanIntervention:
 * 'always'` tool (e.g. lobe-agent `askUserQuestion`) during a GATEWAY/server
 * run. When present, the new op writes the human-provided answer as the pending
 * tool message's result and resumes from `phase: 'tool_result'` — the tool is
 * NOT re-executed, so the server runtime never overwrites the answer with a
 * fresh "pending" placeholder.
 *
 * Kept as a top-level field (not folded into `appContext`) so the server schema
 * can validate it independently.
 */
export interface ResumeToolResultParam {
  /** The human-provided tool result (the answer text). */
  content: string;
  /** ID of the pending `role='tool'` message this result targets. */
  parentMessageId: string;
  /** Optional plugin state to persist on the tool message. */
  pluginState?: Record<string, unknown>;
  /** tool_call_id of the pending tool call being answered. */
  toolCallId: string;
}

export interface ExecAgentTaskParams {
  agentId?: string;
  appContext?: ExecAgentAppContext;
  autoStart?: boolean;
  deviceId?: string;
  existingMessageIds?: string[];
  /** File IDs of already-uploaded attachments to attach to the new user message */
  fileIds?: string[];
  /**
   * Agents the user @-mentioned in this message (multi-mention). The server
   * enables the callAgent tool and injects the mentioned-agents delegation
   * context so the supervisor run delegates to them instead of answering itself.
   */
  mentionedAgents?: RuntimeMentionedAgent[];
  /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
  parentMessageId?: string;
  prompt: string;
  /** Resume a previous op paused on `human_approve_required` instead of starting from a fresh user prompt. */
  resumeApproval?: ResumeApprovalParam;
  /** Resume a previous op paused on a human-intervention tool by carrying the human answer as the tool result. */
  resumeToolResult?: ResumeToolResultParam;
  /** Tool identifiers the user @-mentioned in this message; the server enables them for this run. */
  selectedToolIds?: string[];
  slug?: string;
  /**
   * Override what initiated this operation. Server defaults to `'chat'` when
   * omitted. Pass a more specific value (`'cli'`, `'openapi'`, …) so the
   * `agent_operations.trigger` column reflects the real source.
   */
  trigger?: string;
  userInterventionConfig?: UserInterventionConfig;
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
  /** Parent operation ID for dispatching callAgent hooks */
  parentOperationId?: string;
  timeout?: number;
  /** Task title (shown in UI, used as thread title) */
  title?: string;
  topicId: string;
}

export interface GetSubAgentTaskStatusParams {
  threadId: string;
}

export interface InterruptTaskParams {
  operationId?: string;
  threadId?: string;
  topicId?: string;
}

/**
 * Parameters for createClientTaskThread
 * Creates a Thread for client-side task execution (desktop only, single agent mode)
 */
export interface CreateClientTaskThreadParams {
  agentId: string;
  groupId?: string;
  /** Initial user message content (task instruction) */
  instruction: string;
  parentMessageId: string;
  title?: string;
  topicId: string;
}

/**
 * Parameters for createClientGroupAgentTaskThread
 * Creates a Thread for client-side task execution in Group mode
 */
export interface CreateClientGroupAgentTaskThreadParams {
  /** The Group ID (required for Group mode) */
  groupId: string;
  /** Initial user message content (task instruction) */
  instruction: string;
  parentMessageId: string;
  /** The Sub-Agent ID that will execute the task (worker agent in group) */
  subAgentId: string;
  title?: string;
  topicId: string;
}

/**
 * Parameters for updateClientTaskThreadStatus
 * Updates Thread status after client-side execution completes
 */
export interface UpdateClientTaskThreadStatusParams {
  completionReason: 'done' | 'error' | 'interrupted';
  error?: string;
  metadata?: {
    totalCost?: number;
    totalMessages?: number;
    totalSteps?: number;
    totalTokens?: number;
    totalToolCalls?: number;
  };
  resultContent?: string;
  threadId: string;
}

class AiAgentService {
  /**
   * Execute a single Agent task.
   * Returns the operationId needed to connect to the Agent Gateway.
   */
  async execAgentTask(
    params: ExecAgentTaskParams,
    options?: { signal?: AbortSignal },
  ): Promise<ExecAgentResult> {
    return await lambdaClient.aiAgent.execAgent.mutate(params, options);
  }

  /**
   * Defer an agent run to a future time. Creates an empty `scheduled` topic that
   * the backend cron fires once `runAt` passes; nothing runs now.
   */
  async scheduleAgentRun(params: ScheduleAgentRunParams): Promise<ScheduleAgentRunResult> {
    return await lambdaClient.aiAgent.scheduleAgentRun.mutate(params);
  }

  /**
   * Execute a sub-agent task (supports both Group and Single Agent mode)
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   */
  /**
   * Get a fresh JWT token for Gateway WebSocket reconnection.
   */
  async refreshGatewayToken(topicId: string): Promise<{ token: string }> {
    return await lambdaClient.aiAgent.refreshGatewayToken.query({ topicId });
  }

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

  /**
   * Create Thread for client-side task execution (desktop only, single agent mode)
   *
   * This method is called when runInClient=true on desktop client.
   * It creates the Thread but does NOT execute the task - execution happens locally.
   */
  async createClientTaskThread(params: CreateClientTaskThreadParams) {
    return await lambdaClient.aiAgent.createClientTaskThread.mutate(params);
  }

  /**
   * Create Thread for client-side task execution in Group mode
   *
   * This method is specifically for Group Chat scenarios where:
   * - Messages may have different agentIds (supervisor, workers)
   * - Thread messages query should not filter by agentId
   */
  async createClientGroupAgentTaskThread(params: CreateClientGroupAgentTaskThreadParams) {
    return await lambdaClient.aiAgent.createClientGroupAgentTaskThread.mutate(params);
  }

  /**
   * Update Thread status after client-side task execution completes
   *
   * This method is called by desktop client after task execution finishes.
   */
  async updateClientTaskThreadStatus(params: UpdateClientTaskThreadStatusParams) {
    return await lambdaClient.aiAgent.updateClientTaskThreadStatus.mutate(params);
  }
}

export const aiAgentService = new AiAgentService();
