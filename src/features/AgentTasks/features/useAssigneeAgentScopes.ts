import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type SidebarAgentItem } from '@/database/repositories/home';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import {
  type AssigneeAgentSection,
  buildAssigneeAgentSections,
  pushRecentAssignee,
} from './assigneeAgentSections';

export interface AssigneeAgentScope {
  id: 'private' | 'workspace';
  sections: AssigneeAgentSection[];
  /** Omitted when the workspace list is the only scope, so it keeps no header. */
  title?: string;
}

interface UseAssigneeAgentScopesParams {
  /** List the user's private agents in their own scope, ahead of the workspace's. */
  offerPrivate: boolean;
  /** Header of the private scope; it says what picking one does to the task. */
  privateTitle: string;
}

/**
 * The agents an assignee picker offers, laid out like the sidebar: the user's
 * private agents and the workspace's, each split into pinned, sidebar groups
 * and the rest; plus the inbox when no group lists it. Shared by the single
 * task picker and the batch actions panel so both group agents the same way.
 */
export const useAssigneeAgentScopes = ({
  offerPrivate,
  privateTitle,
}: UseAssigneeAgentScopesParams) => {
  const { t } = useTranslation(['chat', 'common', 'topic']);

  useFetchAgentList();

  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const ungroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const privateAgentGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privatePinnedAgents = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const privateUngroupedAgents = useHomeStore(
    homeAgentListSelectors.privateUngroupedAgents,
    isEqual,
  );
  const hasPrivateAgents = useHomeStore(homeAgentListSelectors.hasPrivateAgents);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore((s) =>
    inboxAgentId ? agentSelectors.getAgentMetaById(inboxAgentId)(s) : undefined,
  );

  const workspaceId = useActiveWorkspaceId();
  const recentKey = workspaceId ?? 'personal';
  const recentIds = useGlobalStore((s) => s.status.recentAssigneeAgentIds?.[recentKey]);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const scopes = useMemo<AssigneeAgentScope[]>(() => {
    const labels = {
      pinned: t('navPanel.pinned', { ns: 'common' }),
      ungrouped: t('defaultList', { ns: 'chat' }),
    };
    const result: AssigneeAgentScope[] = [];

    if (offerPrivate)
      result.push({
        id: 'private',
        sections: buildAssigneeAgentSections({
          groups: privateAgentGroups,
          labels,
          pinned: privatePinnedAgents,
          scope: 'private',
          ungrouped: privateUngroupedAgents,
        }),
        title: privateTitle,
      });

    result.push({
      id: 'workspace',
      sections: buildAssigneeAgentSections({
        groups: agentGroups,
        labels,
        pinned: pinnedAgents,
        scope: 'workspace',
        ungrouped: ungroupedAgents,
      }),
      title: hasPrivateAgents
        ? t('taskManager.agentSelector.workspaceGroup', { ns: 'topic' })
        : undefined,
    });

    return result;
  }, [
    agentGroups,
    hasPrivateAgents,
    offerPrivate,
    pinnedAgents,
    privateAgentGroups,
    privatePinnedAgents,
    privateTitle,
    privateUngroupedAgents,
    t,
    ungroupedAgents,
  ]);

  // The sidebar keeps the inbox above every group, so it leads the list here
  // too, ahead of Recent, where a header-less row would read as a recent pick.
  const inboxAgent = useMemo<SidebarAgentItem | undefined>(() => {
    if (!inboxAgentId) return;
    const listed = scopes.some((scope) =>
      scope.sections.some((section) => section.agents.some((agent) => agent.id === inboxAgentId)),
    );
    if (listed) return;
    return {
      avatar: inboxMeta?.avatar || DEFAULT_INBOX_AVATAR,
      description: null,
      id: inboxAgentId,
      pinned: false,
      title: agentDisplayName(inboxMeta, t('inbox.title', { ns: 'chat' })),
      type: 'agent' as const,
      updatedAt: new Date(),
    };
  }, [inboxAgentId, inboxMeta, scopes, t]);

  const privateAgentIds = useMemo(
    () =>
      new Set(
        scopes
          .find((scope) => scope.id === 'private')
          ?.sections.flatMap((section) => section.agents.map((agent) => agent.id)),
      ),
    [scopes],
  );

  /** Move a picked agent to the front of this workspace's Recent list. */
  const rememberAssignee = useCallback(
    (agentId: string) => {
      const current = useGlobalStore.getState().status.recentAssigneeAgentIds?.[recentKey];
      updateSystemStatus({
        recentAssigneeAgentIds: { [recentKey]: pushRecentAssignee(current, agentId) },
      });
    },
    [recentKey, updateSystemStatus],
  );

  return {
    hasPrivateAgents,
    inboxAgent,
    isAgentListInit,
    privateAgentIds,
    recentIds,
    rememberAssignee,
    scopes,
    workspaceId,
  };
};
