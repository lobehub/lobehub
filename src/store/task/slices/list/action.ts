import type { TaskStatus } from '@lobechat/types';
import { useEffect } from 'react';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { isScheduledTaskListKey, isTaskListKey, projectionKeys, taskKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  taskGroupListViewContract,
  taskListViewContract,
  useProjectionViewHydration,
} from '@/projection';
import {
  taskGroupListProjectionQuery,
  taskListProjectionQuery,
} from '@/projection/modules/task/queries';
import { useProjectionRequest } from '@/projection/query/hook';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskKanbanGroupBy, TaskListVisibilityFilter, TaskViewMode } from './initialState';

export const ALL_AGENTS_LIST_KEY = '__all__';
const PROJECT_LIST_KEY_PREFIX = '__project__:';

const projectIdFromListKey = (key?: string) =>
  key?.startsWith(PROJECT_LIST_KEY_PREFIX) ? key.slice(PROJECT_LIST_KEY_PREFIX.length) : undefined;

const DEFAULT_KANBAN_GROUPS = [
  { key: 'needsInput', statuses: ['paused', 'failed'] },
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'running', statuses: ['running', 'scheduled'] },
  { key: 'done', statuses: ['completed'] },
  { key: 'canceled', statuses: ['canceled'] },
];

const filterToServerVisibility = (
  filter: 'all' | 'private' | 'workspace',
): 'private' | 'public' | undefined => {
  if (filter === 'all') return undefined;
  if (filter === 'workspace') return 'public';
  return 'private';
};

type Setter = StoreSetter<TaskStore>;

export const createTaskListSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskListSliceActionImpl(set, get, _api);

export class TaskListSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshTaskGroupList = async (): Promise<void> => {
    const {
      groupListQueryAutomated,
      listAgentId,
      listGroupBy,
      listGroupExcludeStatuses,
      listVisibility,
    } = this.#get();
    await mutate(
      taskKeys.groupList(
        listAgentId,
        listVisibility,
        listGroupBy,
        listGroupExcludeStatuses,
        projectIdFromListKey(listAgentId),
        groupListQueryAutomated,
      ),
    );
  };

  fetchTaskList = async (params: Parameters<typeof taskService.list>[0]) =>
    taskService.list(params);

  refreshTaskList = async (): Promise<void> => {
    const {
      groupListQueryAutomated,
      listAgentId,
      listGroupBy,
      listGroupExcludeStatuses,
      listVisibility,
    } = this.#get();
    const projectId = projectIdFromListKey(listAgentId);
    await Promise.all([
      mutate(isTaskListKey),
      mutate(
        taskKeys.groupList(
          listAgentId,
          listVisibility,
          listGroupBy,
          listGroupExcludeStatuses,
          projectId,
          groupListQueryAutomated,
        ),
      ),
      mutate(projectionKeys.scheduledTasks(getCacheScope())),
      mutate(projectionKeys.tasks(getCacheScope())),
      mutate(isScheduledTaskListKey),
    ]);
  };

  setListAgentId = (agentId?: string): void => {
    this.#set({ listAgentId: agentId }, false, 'setListAgentId');
  };

  setListVisibility = (visibility: TaskListVisibilityFilter): void => {
    if (this.#get().listVisibility === visibility) return;
    this.#set(
      {
        listQueryVisibility: visibility,
        listVisibility: visibility,
      },
      false,
      'setListVisibility',
    );
  };

  setViewMode = (mode: TaskViewMode): void => {
    this.#set({ viewMode: mode }, false, 'setViewMode');
  };

  useFetchTaskGroupList = (
    options: {
      agentId?: string;
      allAgents?: boolean;
      automated?: boolean;
      enabled?: boolean;
      excludeStatuses?: readonly TaskStatus[];
      groupBy?: TaskKanbanGroupBy;
      projectId?: string;
    } = {},
  ) => {
    const {
      agentId,
      allAgents = false,
      automated,
      enabled = true,
      excludeStatuses,
      groupBy = 'status',
      projectId,
    } = options;
    const effectiveKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : allAgents
        ? ALL_AGENTS_LIST_KEY
        : agentId;
    const excludeStatusesSignature = excludeStatuses?.length
      ? [...excludeStatuses].sort().join(',')
      : undefined;
    const { groupListQueryAutomated, listAgentId, listGroupBy, listGroupExcludeStatuses } =
      this.#get();
    const isQueryScopeCurrent =
      !effectiveKey ||
      (listAgentId === effectiveKey &&
        groupListQueryAutomated === automated &&
        listGroupBy === groupBy &&
        listGroupExcludeStatuses === excludeStatusesSignature);

    useEffect(() => {
      if (!effectiveKey) return;

      const current = this.#get();
      if (
        current.listAgentId === effectiveKey &&
        current.groupListQueryAutomated === automated &&
        current.listGroupBy === groupBy &&
        current.listGroupExcludeStatuses === excludeStatusesSignature
      ) {
        return;
      }

      this.#set(
        {
          groupListQueryAutomated: automated,
          listAgentId: effectiveKey,
          listGroupBy: groupBy,
          listGroupExcludeStatuses: excludeStatusesSignature,
        },
        false,
        'useFetchTaskGroupList/syncQueryScope',
      );
    }, [automated, effectiveKey, excludeStatusesSignature, groupBy]);
    const listVisibility = this.#get().listVisibility;

    useProjectionViewHydration(
      taskGroupListViewContract,
      { agentKey: effectiveKey ?? '', visibility: listVisibility },
      enabled && Boolean(effectiveKey),
    );

    const requestParams = {
      request: {
        assigneeAgentId: allAgents ? undefined : agentId,
        ...(automated === undefined ? {} : { automated }),
        excludeStatuses: excludeStatuses?.length ? [...excludeStatuses] : undefined,
        ...(groupBy === 'status' ? { groups: DEFAULT_KANBAN_GROUPS } : { groupBy }),
        projectId,
        visibility: filterToServerVisibility(listVisibility),
      },
      signature: { agentKey: effectiveKey, visibility: listVisibility },
    };
    const swr = useProjectionRequest(
      enabled && effectiveKey
        ? taskKeys.groupList(
            effectiveKey,
            listVisibility,
            groupBy,
            excludeStatusesSignature,
            projectId,
            automated,
          )
        : null,
      taskGroupListProjectionQuery,
      requestParams,
      { revalidateOnFocus: false },
    );

    return { ...swr, isQueryScopeCurrent };
  };

  useFetchScheduledTaskList = (
    options: {
      agentId?: string;
      enabled?: boolean;
      limit?: number;
      offset?: number;
      projectId?: string;
    } = {},
  ) => {
    const { agentId, enabled = true, limit, offset, projectId } = options;
    const scopeKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : (agentId ?? ALL_AGENTS_LIST_KEY);
    return useClientDataSWR(
      enabled ? taskKeys.scheduledList(scopeKey, 'all', limit, offset) : null,
      async () =>
        this.fetchTaskList({
          ...(projectId ? { projectId } : agentId ? { assigneeAgentId: agentId } : {}),
          automated: true,
          limit,
          offset,
          orderBy: 'updatedAt',
        }),
      { revalidateOnFocus: false },
    );
  };

  useFetchTaskList = (
    options: {
      agentId?: string;
      allAgents?: boolean;
      automated?: boolean;
      enabled?: boolean;
      orderBy?: 'createdAt' | 'updatedAt';
      projectId?: string;
      statuses?: readonly TaskStatus[];
      visibility?: TaskListVisibilityFilter;
    } = {},
  ) => {
    const {
      agentId,
      allAgents = false,
      automated,
      enabled = true,
      orderBy,
      projectId,
      statuses,
      visibility,
    } = options;
    const effectiveKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : allAgents
        ? ALL_AGENTS_LIST_KEY
        : agentId;
    const listVisibility = visibility ?? this.#get().listVisibility;
    const statusesSignature = statuses?.length ? [...statuses].sort().join(',') : undefined;
    const { listAgentId, listQueryAutomated, listQueryStatuses, listQueryVisibility } = this.#get();

    useProjectionViewHydration(
      taskListViewContract,
      { agentKey: effectiveKey ?? '', visibility: listVisibility },
      enabled && Boolean(effectiveKey),
    );

    if (
      effectiveKey &&
      (listAgentId !== effectiveKey ||
        listQueryVisibility !== listVisibility ||
        listQueryAutomated !== automated ||
        listQueryStatuses !== statusesSignature)
    ) {
      this.#set(
        {
          listAgentId: effectiveKey,
          listQueryAutomated: automated,
          listQueryStatuses: statusesSignature,
          listQueryVisibility: listVisibility,
        },
        false,
        'useFetchTaskList/syncQueryScope',
      );
    }

    const requestParams = {
      request: {
        ...(allAgents || projectId ? {} : { assigneeAgentId: agentId }),
        automated,
        orderBy,
        projectId,
        statuses: statuses?.length ? [...statuses] : undefined,
        visibility: filterToServerVisibility(listVisibility),
      },
      signature: { agentKey: effectiveKey, visibility: listVisibility },
    };
    return useProjectionRequest(
      enabled && effectiveKey
        ? taskKeys.list(effectiveKey, listVisibility, orderBy, projectId, { automated, statuses })
        : null,
      taskListProjectionQuery,
      requestParams,
      { revalidateOnFocus: false },
    );
  };
}

export type TaskListSliceAction = Pick<TaskListSliceActionImpl, keyof TaskListSliceActionImpl>;
