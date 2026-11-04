import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import {
  agentDisplayName,
  TASK_LIST_FILTER_NONE,
  type TaskListFilterDateField,
  type TaskListFilterSetField,
  toTaskListFilterAgentCreator,
} from '@lobechat/types';
import { Avatar, Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import type { LucideIcon } from 'lucide-react';
import {
  BotIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CircleDashedIcon,
  FolderClosedIcon,
  SignalHighIcon,
  UserRoundIcon,
  UserRoundPenIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import UserAvatar from '@/components/UserAvatar';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useCurrentProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { PRIORITY_META } from '../../features/TaskPriorityTag';
import TaskStatusIcon from '../../features/TaskStatusIcon';
import { UnassignedAssigneeIcon } from '../../features/UnassignedAssigneeIcon';
import { hasWorkspaceMemberDirectory } from '../../shared/memberAssigneeMode';
import { toAgentFilterOption } from './agentFilterOption';
import type { TaskFilterValue } from './taskFilterState';

export interface TaskFilterOption {
  icon?: ReactNode;
  label: string;
  value: TaskFilterValue;
}

export interface TaskFilterSetFieldDef {
  icon: LucideIcon;
  key: TaskListFilterSetField;
  kind: 'set';
  label: string;
  options: TaskFilterOption[];
}

export interface TaskFilterDateFieldDef {
  icon: LucideIcon;
  key: TaskListFilterDateField;
  kind: 'date';
  label: string;
}

export type TaskFilterFieldDef = TaskFilterDateFieldDef | TaskFilterSetFieldDef;

/** Menu order of the priorities: the way the board lays them out, "no priority" last. */
const PRIORITY_ORDER = [1, 2, 3, 4, 0];

const OPTION_ICON_SIZE = 16;

interface UseTaskFilterFieldsParams {
  /** The page is one agent's list, so the agent field would only ever hold that agent. */
  agentId?: string;
  /** The page is one project's list; same reason for the project field. */
  projectId?: string;
}

/**
 * Everything the "Add filter" menu and the filter chips can offer on this
 * page, with display labels and icons for each value. Assignee and creator
 * list the workspace members, or just the signed-in user in personal mode;
 * the creator field also lists the agents. A member value also matches the
 * tasks their agents created for them; an agent value narrows to that agent.
 */
export const useTaskFilterFields = ({
  agentId,
  projectId,
}: UseTaskFilterFieldsParams): TaskFilterFieldDef[] => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();
  const hasMembers = hasWorkspaceMemberDirectory(activeWorkspaceId);

  useFetchAgentList();
  const sidebarAgents = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore((s) =>
    inboxAgentId ? agentSelectors.getAgentMetaById(inboxAgentId)(s) : undefined,
  );

  useFetchWorkspaceMembers();
  const members = useWorkspaceMembers();
  const selfUserId = useUserStore(userProfileSelectors.userId);
  const selfAvatar = useUserStore(userProfileSelectors.userAvatar);
  const selfName = useUserStore(userProfileSelectors.displayUserName);

  const useFetchProjectList = useProjectStore((s) => s.useFetchProjectList);
  useFetchProjectList(!projectId);
  const projects = useCurrentProjectList();

  return useMemo(() => {
    const statusField: TaskFilterSetFieldDef = {
      icon: CircleDashedIcon,
      key: 'status',
      kind: 'set',
      label: t('taskList.filter.field.status'),
      options: TASK_STATUSES.map((status) => ({
        icon: <TaskStatusIcon size={OPTION_ICON_SIZE} status={status} />,
        label: t(`taskDetail.status.${status}`),
        value: status,
      })),
    };

    const priorityField: TaskFilterSetFieldDef = {
      icon: SignalHighIcon,
      key: 'priority',
      kind: 'set',
      label: t('taskList.filter.field.priority'),
      options: PRIORITY_ORDER.map((level) => {
        const meta = PRIORITY_META[level];
        const PriorityIcon = meta.icon;
        return {
          icon: <PriorityIcon size={OPTION_ICON_SIZE} />,
          label: t(`taskDetail.${meta.labelKey}` as never, { defaultValue: meta.label }),
          value: level,
        };
      }),
    };

    const agentOptions: TaskFilterOption[] = [
      {
        icon: <UnassignedAssigneeIcon kind={'agent'} size={OPTION_ICON_SIZE} />,
        label: t('taskList.filter.noAgent'),
        value: TASK_LIST_FILTER_NONE,
      },
    ];
    const seenAgents = new Set<string>();
    if (inboxAgentId) {
      seenAgents.add(inboxAgentId);
      agentOptions.push(
        toAgentFilterOption({
          avatar: inboxMeta?.avatar || DEFAULT_INBOX_AVATAR,
          backgroundColor: inboxMeta?.backgroundColor,
          id: inboxAgentId,
          label: agentDisplayName(inboxMeta, t('inbox.title')),
        }),
      );
    }
    for (const agent of sidebarAgents) {
      if (agent.type !== 'agent' || seenAgents.has(agent.id)) continue;
      seenAgents.add(agent.id);
      agentOptions.push(
        toAgentFilterOption({
          avatar: typeof agent.avatar === 'string' ? agent.avatar : undefined,
          backgroundColor: agent.backgroundColor,
          id: agent.id,
          label: agentDisplayName(agent, t('taskList.filter.untitledAgent')),
        }),
      );
    }
    const agentField: TaskFilterSetFieldDef = {
      icon: BotIcon,
      key: 'agent',
      kind: 'set',
      label: t('taskList.filter.field.agent'),
      options: agentOptions,
    };

    const memberOptions: TaskFilterOption[] = hasMembers
      ? members.map((member) => {
          const name =
            member.user?.fullName || member.user?.username || member.user?.email || member.userId;
          return {
            icon: <UserAvatar avatar={member.user?.avatar} name={name} size={OPTION_ICON_SIZE} />,
            label: name,
            value: member.userId,
          };
        })
      : selfUserId
        ? [
            {
              icon: <UserAvatar avatar={selfAvatar} name={selfName} size={OPTION_ICON_SIZE} />,
              label: selfName || t('taskList.filter.me'),
              value: selfUserId,
            },
          ]
        : [];
    const assigneeField: TaskFilterSetFieldDef = {
      icon: UserRoundIcon,
      key: 'assignee',
      kind: 'set',
      label: t('taskList.filter.field.assignee'),
      options: [
        {
          icon: <UnassignedAssigneeIcon kind={'human'} size={OPTION_ICON_SIZE} />,
          label: t('taskList.unassigned'),
          value: TASK_LIST_FILTER_NONE,
        },
        ...memberOptions,
      ],
    };
    const creatorField: TaskFilterSetFieldDef = {
      icon: UserRoundPenIcon,
      key: 'creator',
      kind: 'set',
      label: t('taskList.filter.field.creator'),
      options: [
        ...memberOptions,
        // Same agents as the agent field, minus "no agent": every task has a creator.
        ...agentOptions
          .filter((option) => option.value !== TASK_LIST_FILTER_NONE)
          .map((option) => ({
            ...option,
            value: toTaskListFilterAgentCreator(String(option.value)),
          })),
      ],
    };

    const projectField: TaskFilterSetFieldDef = {
      icon: FolderClosedIcon,
      key: 'project',
      kind: 'set',
      label: t('taskList.filter.field.project'),
      options: [
        {
          icon: <Icon icon={FolderClosedIcon} size={OPTION_ICON_SIZE} />,
          label: t('taskList.filter.noProject'),
          value: TASK_LIST_FILTER_NONE,
        },
        ...projects.map((project) => ({
          icon: project.avatar ? (
            <Avatar avatar={project.avatar} size={OPTION_ICON_SIZE} />
          ) : (
            <Icon icon={FolderClosedIcon} size={OPTION_ICON_SIZE} />
          ),
          label: project.name || t('taskList.filter.untitledProject'),
          value: project.id,
        })),
      ],
    };

    const dateFields: TaskFilterDateFieldDef[] = [
      {
        icon: CalendarPlusIcon,
        key: 'createdAt',
        kind: 'date',
        label: t('taskList.filter.field.createdAt'),
      },
      {
        icon: CalendarClockIcon,
        key: 'updatedAt',
        kind: 'date',
        label: t('taskList.filter.field.updatedAt'),
      },
      {
        icon: CalendarCheckIcon,
        key: 'completedAt',
        kind: 'date',
        label: t('taskList.filter.field.completedAt'),
      },
    ];

    return [
      statusField,
      priorityField,
      ...(agentId ? [] : [agentField]),
      assigneeField,
      creatorField,
      ...(projectId ? [] : [projectField]),
      ...dateFields,
    ];
  }, [
    agentId,
    hasMembers,
    inboxAgentId,
    inboxMeta,
    members,
    projectId,
    projects,
    selfAvatar,
    selfName,
    selfUserId,
    sidebarAgents,
    t,
  ]);
};
