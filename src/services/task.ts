import type { CheckpointConfig } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class TaskService {
  // ── Queries ──

  find = async (id: string) => lambdaClient.task.find.query({ id });

  getDetail = async (id: string) => lambdaClient.task.detail.query({ id });

  list = async (params: {
    assigneeAgentId?: string;
    limit?: number;
    offset?: number;
    parentTaskId?: string | null;
    status?: string;
  }) => lambdaClient.task.list.query(params);

  groupList = async (params: {
    assigneeAgentId?: string;
    groups: Array<{
      key: string;
      limit?: number;
      offset?: number;
      statuses: string[];
    }>;
    parentTaskId?: string | null;
  }) => lambdaClient.task.groupList.query(params);

  getSubtasks = async (id: string) => lambdaClient.task.getSubtasks.query({ id });

  getTaskTree = async (id: string) => lambdaClient.task.getTaskTree.query({ id });

  getTopics = async (id: string) => lambdaClient.task.getTopics.query({ id });

  getDependencies = async (id: string) => lambdaClient.task.getDependencies.query({ id });

  getPinnedDocuments = async (id: string) => lambdaClient.task.getPinnedDocuments.query({ id });

  getCheckpoint = async (id: string) => lambdaClient.task.getCheckpoint.query({ id });

  getReview = async (id: string) => lambdaClient.task.getReview.query({ id });

  // ── Mutations ──

  create = async (params: {
    assigneeAgentId?: string;
    assigneeUserId?: string;
    description?: string;
    identifierPrefix?: string;
    instruction: string;
    name?: string;
    parentTaskId?: string;
    priority?: number;
  }) => lambdaClient.task.create.mutate(params);

  update = async (
    id: string,
    data: {
      assigneeAgentId?: string | null;
      assigneeUserId?: string | null;
      config?: Record<string, unknown>;
      context?: Record<string, unknown>;
      description?: string;
      // heartbeatInterval: periodic execution interval (seconds), controls how often the task auto-executes
      heartbeatInterval?: number;
      // heartbeatTimeout: watchdog timeout threshold (seconds), used to detect if a running task is stuck
      heartbeatTimeout?: number | null;
      instruction?: string;
      name?: string;
      priority?: number;
    },
  ) => lambdaClient.task.update.mutate({ id, ...data });

  delete = async (id: string) => lambdaClient.task.delete.mutate({ id });

  clearAll = async () => lambdaClient.task.clearAll.mutate();

  updateStatus = async (
    id: string,
    status: 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running',
    error?: string,
  ) => lambdaClient.task.updateStatus.mutate({ error, id, status });

  run = async (id: string, params?: { continueTopicId?: string; prompt?: string }) =>
    lambdaClient.task.run.mutate({ id, ...params });

  addComment = async (id: string, content: string, opts?: { briefId?: string; topicId?: string }) =>
    lambdaClient.task.addComment.mutate({ content, id, ...opts });

  addDependency = async (
    taskId: string,
    dependsOnId: string,
    type: 'blocks' | 'relates' = 'blocks',
  ) => lambdaClient.task.addDependency.mutate({ dependsOnId, taskId, type });

  removeDependency = async (taskId: string, dependsOnId: string) =>
    lambdaClient.task.removeDependency.mutate({ dependsOnId, taskId });

  reorderSubtasks = async (id: string, order: string[]) =>
    lambdaClient.task.reorderSubtasks.mutate({ id, order });

  cancelTopic = async (topicId: string) => lambdaClient.task.cancelTopic.mutate({ topicId });

  deleteTopic = async (topicId: string) => lambdaClient.task.deleteTopic.mutate({ topicId });

  // Safely merges config without overwriting other config fields such as checkpoint/review
  updateConfig = async (id: string, config: Record<string, unknown>) =>
    lambdaClient.task.updateConfig.mutate({ config, id });

  updateCheckpoint = async (id: string, checkpoint: CheckpointConfig) =>
    lambdaClient.task.updateCheckpoint.mutate({ checkpoint, id });

  updateReview = async (...args: Parameters<typeof lambdaClient.task.updateReview.mutate>) =>
    lambdaClient.task.updateReview.mutate(...args);

  runReview = async (id: string, params?: { content?: string; topicId?: string }) =>
    lambdaClient.task.runReview.mutate({ id, ...params });

  pinDocument = async (taskId: string, documentId: string, pinnedBy?: string) =>
    lambdaClient.task.pinDocument.mutate({ documentId, pinnedBy, taskId });

  unpinDocument = async (taskId: string, documentId: string) =>
    lambdaClient.task.unpinDocument.mutate({ documentId, taskId });

  // ── Brief operations ──

  resolveBrief = async (id: string, opts?: { action?: string; comment?: string }) =>
    lambdaClient.brief.resolve.mutate({ id, ...opts });

  markBriefRead = async (id: string) => lambdaClient.brief.markRead.mutate({ id });
}

export const taskService = new TaskService();
