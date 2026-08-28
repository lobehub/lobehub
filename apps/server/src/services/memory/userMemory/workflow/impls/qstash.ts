import type { FlowControl } from '@upstash/qstash';
import type { Client } from '@upstash/workflow';

import { OtelWorkflowClient } from '@/libs/qstash';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
  UserTopicWorkflowPayload,
} from '../../extract';
import type { MemoryWorkflowTriggerResult, MemoryWorkflowTriggerService } from '../types';

const WORKFLOW_PATHS = {
  hourly: '/api/workflows/memory-user-memory/call-cron-hourly-analysis',
  personaUpdate: '/api/workflows/memory-user-memory/pipelines/persona/update-writing',
  topic: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
  topicBatch: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics',
  userTopics: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics',
  users: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
} as const;

const PROCESS_USERS_FLOW_CONTROL = {
  key: 'memory-user-memory.pipelines.chat-topic.process-users',
  parallelism: 1,
  ratePerSecond: 1,
} satisfies FlowControl;

const getProcessUserTopicsFlowControl = (): FlowControl => {
  const { workflow } = parseMemoryExtractionConfig();

  return {
    key: 'memory-user-memory.pipelines.chat-topic.process-user-topics',
    parallelism: workflow?.processUserTopicsParallelism ?? 25,
  };
};

const getWorkflowUrl = (path: string, baseUrl: string) => new URL(path, baseUrl).toString();

const getWorkflowClient = () => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to trigger workflows');

  const config: ConstructorParameters<typeof Client>[0] = { token };

  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }

  return new OtelWorkflowClient(config);
};

/**
 * QStash-backed workflow trigger implementation.
 *
 * This is the existing behavior — delegates to Upstash QStash Workflows
 * via HTTP callbacks. Used when AGENT_RUNTIME_MODE=queue (cloud/Vercel).
 */
export class QStashWorkflowTrigger implements MemoryWorkflowTriggerService {
  private client: Client;

  constructor() {
    this.client = getWorkflowClient();
  }

  async triggerProcessUsers(
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const url = getWorkflowUrl(WORKFLOW_PATHS.users, payload.baseUrl);
    return this.client.trigger({
      body: payload,
      flowControl: PROCESS_USERS_FLOW_CONTROL,
      headers: options?.extraHeaders,
      url,
    });
  }

  async triggerHourly(
    payload: MemoryExtractionHourlyWorkflowPayload,
    options?: { extraHeaders?: Record<string, string>; workflowRunId?: string },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const url = getWorkflowUrl(WORKFLOW_PATHS.hourly, payload.baseUrl);
    return this.client.trigger({
      body: payload,
      headers: options?.extraHeaders,
      url,
      workflowRunId: options?.workflowRunId,
    });
  }

  async triggerProcessUserTopics(
    payload: UserTopicWorkflowPayload,
    options?: { extraHeaders?: Record<string, string> },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const url = getWorkflowUrl(WORKFLOW_PATHS.userTopics, payload.baseUrl);
    return this.client.trigger({
      body: payload,
      flowControl: getProcessUserTopicsFlowControl(),
      headers: options?.extraHeaders,
      url,
    });
  }

  async triggerProcessTopics(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const url = getWorkflowUrl(WORKFLOW_PATHS.topicBatch, payload.baseUrl);
    return this.client.trigger({
      body: payload,
      flowControl: {
        key: `memory-user-memory.pipelines.chat-topic.process-topics.user.${userId}`,
        parallelism: 20,
      },
      headers: options?.extraHeaders,
      url,
    });
  }

  async triggerProcessTopic(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const url = getWorkflowUrl(WORKFLOW_PATHS.topic, payload.baseUrl);
    return this.client.trigger({
      body: payload,
      flowControl: {
        key: `memory-user-memory.pipelines.chat-topic.process-topic.user.${userId}`,
        parallelism: 5,
      } satisfies FlowControl,
      headers: options?.extraHeaders,
      url,
    });
  }

  async triggerPersonaUpdate(
    userId: string,
    baseUrl: string,
    options?: { extraHeaders?: Record<string, string>; hourlyTaskId?: string },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const url = getWorkflowUrl(WORKFLOW_PATHS.personaUpdate, baseUrl);
    return this.client.trigger({
      body: { hourlyTaskId: options?.hourlyTaskId, userIds: [userId] },
      flowControl: {
        key: `memory-user-memory.pipelines.persona.update-write.${userId}`,
        parallelism: 1,
      } satisfies FlowControl,
      headers: options?.extraHeaders,
      url,
    });
  }
}
