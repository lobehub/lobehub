import type { WorkSummaryItem } from '@lobechat/types';

const timestamp = new Date('2026-01-01T00:00:00Z');
const common = {
  createdAt: timestamp,
  currentVersionId: null,
  description: 'A preview with content that wraps at narrower widths.',
  id: 'fixture-work',
  identifier: 'WORK-1',
  originAgentId: null,
  originThreadId: null,
  originTopicId: null,
  resourceId: 'fixture-resource',
  resourceDeleted: false,
  status: null,
  title: 'A detailed title',
  toolIdentifier: 'fixture',
  toolName: 'fixture',
  updatedAt: timestamp,
  url: null,
  userId: 'fixture-user',
  visibility: 'private' as const,
  workspaceId: null,
  version: null,
  totalCost: null,
  event: {
    createdAt: timestamp,
    cumulativeCost: null,
    cumulativeUsage: null,
    id: 'fixture-event',
    metadata: null,
    changeType: 'created' as const,
    rootOperationId: null,
    messageId: null,
    toolCallId: null,
    toolName: 'fixture',
    version: 1,
  },
};

export const getWorkPreviewItem = (kind: string): WorkSummaryItem => {
  if (kind.startsWith('task-'))
    return {
      ...common,
      type: 'task',
      resourceType: 'task',
      task: {
        identifier: 'TASK-1',
        instruction: common.description,
        name: common.title,
        priority: null,
        status: kind === 'task-completed' ? 'completed' : 'todo',
      },
    };
  if (kind === 'github' || kind === 'linear')
    return {
      ...common,
      type: 'external',
      resourceType: kind === 'github' ? 'github_pull_request' : 'linear_issue',
    };
  if (kind === 'canvas') return { ...common, type: 'canvas', resourceType: 'canvas' };
  if (kind === 'file')
    return { ...common, type: 'file', resourceType: 'file', description: 'report.pdf' };
  return {
    ...common,
    type: 'document',
    resourceType: 'document',
    status: kind === 'warning' ? 'in_progress' : kind === 'info' ? 'todo' : 'completed',
  };
};
