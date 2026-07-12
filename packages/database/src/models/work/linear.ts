import type {
  LinearWorkPatchField,
  LinearWorkVersionSnapshot,
  RegisterLinearWorkParams,
} from '@lobechat/types';

import { slimLinearSnapshotForSummary } from './internal';
import { createSnapshotWorkAdapter, createSnapshotWorkRegister } from './snapshotWork';

export const linearSnapshot = (
  params: RegisterLinearWorkParams,
  previous?: LinearWorkVersionSnapshot | null,
): { linear: LinearWorkVersionSnapshot } => {
  const patchFields = new Set(params.patchFields ?? []);
  const pick = <T>(field: LinearWorkPatchField, value: T | null | undefined, fallback: T) =>
    patchFields.has(field)
      ? (value ?? fallback)
      : ((previous?.[field] as T | undefined) ?? fallback);

  return {
    linear: {
      assignee: pick('assignee', params.assignee, null),
      assigneeId: pick('assigneeId', params.assigneeId, null),
      color: pick('color', params.color, null),
      content: pick('content', params.content, null),
      createdAt: pick('createdAt', params.createdAt, null),
      description: pick('description', params.description, null),
      dueDate: pick('dueDate', params.dueDate, null),
      id: params.resourceId,
      icon: pick('icon', params.icon, null),
      identifier: pick('identifier', params.resourceLabel, null),
      issueId: pick('issueId', params.issueId, null),
      issueIdentifier: pick('issueIdentifier', params.issueIdentifier, null),
      labels: pick('labels', params.labels, []),
      parentId: pick('parentId', params.parentId, null),
      priority: pick('priority', params.priority, null),
      priorityValue: pick('priorityValue', params.priorityValue, null),
      project: pick('project', params.project, null),
      projectId: pick('projectId', params.projectId, null),
      slugId: pick('slugId', params.slugId, null),
      status: pick('status', params.status, null),
      statusType: pick('statusType', params.statusType, null),
      targetId: pick('targetId', params.targetId, null),
      targetIdentifier: pick('targetIdentifier', params.targetIdentifier, null),
      targetType: pick('targetType', params.targetType, null),
      team: pick('team', params.team, null),
      teamId: pick('teamId', params.teamId, null),
      title: pick('title', params.title, null),
      updatedAt: pick('updatedAt', params.updatedAt, null),
      url: pick('url', params.url, null),
    } satisfies LinearWorkVersionSnapshot,
  };
};

export const registerLinearWork = createSnapshotWorkRegister<
  RegisterLinearWorkParams,
  LinearWorkVersionSnapshot
>({
  // Linear update responses can be partial, e.g. { id, state }; keep prior labels/team.
  buildSnapshot: linearSnapshot,
  type: 'linear',
});

export const linearWorkAdapter = createSnapshotWorkAdapter<LinearWorkVersionSnapshot>({
  slimForSummary: slimLinearSnapshotForSummary,
  type: 'linear',
});
