import type {
  TaskDetailData,
  TaskGroupListIndex,
  TaskItem,
  TaskListIndex,
  TaskListItem,
  TaskListQuerySignature,
  TaskProjection,
} from '@lobechat/types';
import { taskGroupListIndexKey, taskListIndexKey } from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';
import { activeProjectionRecord } from '../../core/record';
import { selectAgentSummary } from '../agent/selectors';

const activeRecord = (record: TaskProjection | undefined): TaskProjection | undefined =>
  activeProjectionRecord(record);

export const selectTaskRow = (record: TaskProjection | undefined): TaskItem | undefined => {
  const active = activeRecord(record);
  const row = active?.fragments.row?.data;
  const assignment = active?.fragments.assignment?.data;
  const description = active?.fragments.description?.data;
  const display = active?.fragments.display?.data;
  const identity = active?.fragments.identity?.data;
  const lifecycle = active?.fragments.lifecycle?.data;
  if (
    !active ||
    !row ||
    !assignment ||
    description?.description === undefined ||
    display?.name === undefined ||
    identity?.identifier === undefined ||
    !lifecycle
  ) {
    return undefined;
  }
  return {
    id: active.id,
    ...row,
    ...assignment,
    description: description.description,
    identifier: identity.identifier,
    name: display.name,
    status: lifecycle.status,
  };
};

export const selectTaskListItem = (
  scope: ProjectionScopeState | undefined,
  record: TaskProjection | undefined,
): TaskListItem | undefined => {
  const row = selectTaskRow(record);
  const participants = activeRecord(record)?.fragments.participants?.data;
  if (!scope || !row || !participants) return undefined;
  const resolved = [] as TaskListItem['participants'];
  for (const participant of participants.participants) {
    if (participant.type === 'user') {
      resolved.push(participant);
      continue;
    }
    const agent = selectAgentSummary(scope.records.agent[participant.id]);
    if (!agent) return undefined;
    resolved.push({
      avatar: typeof agent.avatar === 'string' ? agent.avatar : null,
      backgroundColor: agent.backgroundColor ?? null,
      id: agent.id,
      name: agent.name,
      title: agent.title ?? agent.name ?? '',
      type: 'agent',
    });
  }
  return { ...row, participants: resolved };
};

export const selectTaskDetail = (
  record: TaskProjection | undefined,
): TaskDetailData | undefined => {
  const active = activeRecord(record);
  const detail = active?.fragments.detail?.data;
  const identifier = active?.fragments.identity?.data.identifier;
  const status = active?.fragments.lifecycle?.data.status;
  if (!active || !detail || identifier === undefined || status === undefined) return undefined;
  return {
    ...detail,
    ...active.fragments.description?.data,
    ...active.fragments.display?.data,
    identifier,
    status,
  };
};

export const findTaskRecordByIdentity = (
  scope: ProjectionScopeState | undefined,
  identity: string,
): TaskProjection | undefined => {
  if (!scope) return undefined;
  return (
    scope.records.task[identity] ??
    Object.values(scope.records.task).find(
      (record) =>
        record.fragments.identity?.data.identifier === identity ||
        record.fragments.detail?.data.id === identity,
    )
  );
};

export const selectTaskListIndex = (
  scope: ProjectionScopeState | undefined,
  signature: TaskListQuerySignature,
): TaskListIndex | undefined =>
  scope?.indexes[taskListIndexKey(signature.agentKey, signature.visibility)];

export const selectTaskGroupListIndex = (
  scope: ProjectionScopeState | undefined,
  signature: TaskListQuerySignature,
): TaskGroupListIndex | undefined =>
  scope?.indexes[taskGroupListIndexKey(signature.agentKey, signature.visibility)];

export type TaskGroupListView = Array<
  Omit<TaskGroupListIndex['groups'][number], 'refs'> & { tasks: TaskItem[] }
>;

export const selectTaskGroupList = (
  scope: ProjectionScopeState | undefined,
  signature: TaskListQuerySignature,
): TaskGroupListView | undefined => {
  const index = selectTaskGroupListIndex(scope, signature);
  if (!scope || !index) return undefined;
  const groups: TaskGroupListView = [];
  for (const { refs, ...group } of index.groups) {
    const tasks: TaskItem[] = [];
    for (const ref of refs) {
      const record = scope.records.task[ref.id];
      if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
      const item = selectTaskRow(record);
      if (!item) return undefined;
      tasks.push(item);
    }
    groups.push({ ...group, tasks });
  }
  return groups;
};
