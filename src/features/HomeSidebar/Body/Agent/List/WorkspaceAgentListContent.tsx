'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp, MoreHorizontal, PinIcon, UsersIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import CreateAgentButton from '../CreateAgentButton';
import { resolveAgentListContentState } from './agentListContentState';
import Group from './Group';
import InboxItem from './InboxItem';
import SessionList from './List';
import { useKeepSidebarGroupsListed, useKeepSidebarListed } from './useAgentList';
import { resolveWorkspaceAgentSections } from './workspaceAgentSections';

/** Team pins beyond this many fold behind a "show more" row. */
export const TEAM_PINNED_VISIBLE_LIMIT = 5;

const SubHeader = memo<{ icon: typeof PinIcon; testId: string; title: string; tooltip?: string }>(
  ({ icon, testId, title, tooltip }) => {
    const node: ReactNode = (
      <Flexbox
        horizontal
        align={'center'}
        data-testid={testId}
        gap={6}
        style={{ paddingBlock: '6px 2px', paddingInline: 10 }}
      >
        <Icon icon={icon} size={12} style={{ opacity: 0.5 }} />
        <Text ellipsis fontSize={11} type={'secondary'} weight={500}>
          {title}
        </Text>
      </Flexbox>
    );

    return tooltip ? (
      <Tooltip placement={'right'} title={tooltip}>
        {node}
      </Tooltip>
    ) : (
      node
    );
  },
);

SubHeader.displayName = 'WorkspaceAgentSubHeader';

/**
 * The merged workspace "Agents" section body (replacing the former separate
 * "Workspace" and "Private" accordions): Inbox → team pins (fixed, set by
 * owners/admins for everyone) → my pins → folders → the rest. Private rows
 * carry a lock icon wherever they appear. Personal mode keeps rendering
 * `AgentListContent`.
 */
const WorkspaceAgentListContent = memo<{ hideInbox?: boolean }>(({ hideInbox }) => {
  const { t } = useTranslation(['common', 'chat']);
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const authLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const contentState = resolveAgentListContentState({
    authLoaded: !!authLoaded,
    isInit,
    isLogin: !!isLogin,
  });

  const pinned = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const privatePinned = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const groups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const ungrouped = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const privateUngrouped = useHomeStore(homeAgentListSelectors.privateUngroupedAgents, isEqual);
  const myPinnedIds = useUserStore(workspaceUserSettingsSelectors.sidebarPinnedItemIds, isEqual);
  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);

  const keep = useKeepSidebarListed();
  const keepGroups = useKeepSidebarGroupsListed();
  const navigate = useWorkspaceAwareNavigate();
  const [teamExpanded, setTeamExpanded] = useState(false);

  const sections = useMemo(() => {
    const resolved = resolveWorkspaceAgentSections({
      groups,
      myPinnedIds,
      pinned,
      privateGroups,
      privatePinned,
      privateUngrouped,
      ungrouped,
    });
    // The team section is fixed: a member's own "remove from sidebar" does
    // not apply to it. Every other section honors the member's hides.
    const rest = keep(resolved.rest);

    return {
      folders: keepGroups(resolved.folders).map((group) => ({
        ...group,
        items: keep(group.items),
      })),
      hasMore: rest.length > agentPageSize,
      myPinned: keep(resolved.myPinned),
      rest: rest.slice(0, agentPageSize),
      teamPinned: resolved.teamPinned,
    };
  }, [
    agentPageSize,
    groups,
    keep,
    keepGroups,
    myPinnedIds,
    pinned,
    privateGroups,
    privatePinned,
    privateUngrouped,
    ungrouped,
  ]);

  if (contentState !== 'ready')
    return (
      <>
        {!hideInbox && <InboxItem style={{ minHeight: 36 }} />}
        {contentState === 'loading' && <SkeletonList rows={3} />}
      </>
    );

  const { folders, hasMore, myPinned, rest, teamPinned } = sections;
  const teamOverflow = teamPinned.length > TEAM_PINNED_VISIBLE_LIMIT;
  const visibleTeamPinned =
    teamOverflow && !teamExpanded ? teamPinned.slice(0, TEAM_PINNED_VISIBLE_LIMIT) : teamPinned;

  return (
    <>
      {!hideInbox && <InboxItem style={{ minHeight: 36 }} />}
      {teamPinned.length > 0 && (
        <Flexbox data-testid={'sidebar-team-pinned'} gap={1}>
          <SubHeader
            icon={UsersIcon}
            testId={'sidebar-team-pinned-header'}
            title={t('navPanel.teamPinned')}
            tooltip={t('navPanel.teamPinnedHint')}
          />
          <SessionList dataSource={visibleTeamPinned} />
          {teamOverflow && (
            <NavItem
              icon={teamExpanded ? ChevronUp : ChevronDown}
              title={
                teamExpanded
                  ? t('navPanel.showLessTeamPinned')
                  : t('navPanel.showMoreTeamPinned', {
                      count: teamPinned.length - TEAM_PINNED_VISIBLE_LIMIT,
                    })
              }
              onClick={() => setTeamExpanded((expanded) => !expanded)}
            />
          )}
        </Flexbox>
      )}
      {myPinned.length > 0 && (
        <Flexbox data-testid={'sidebar-my-pinned'} gap={1}>
          <SubHeader
            icon={PinIcon}
            testId={'sidebar-my-pinned-header'}
            title={t('navPanel.myPinned')}
          />
          <SessionList dataSource={myPinned} />
        </Flexbox>
      )}
      {folders.length > 0 && <Group dataSource={folders} />}
      {rest.length > 0 && (
        <Flexbox data-testid={'sidebar-agents-rest'} gap={1}>
          <SessionList dataSource={rest} />
        </Flexbox>
      )}
      {hasMore ? (
        <NavItem
          icon={MoreHorizontal}
          title={t('input.more', { ns: 'chat' })}
          onClick={() => navigate('/agents')}
        />
      ) : (
        // New agents from the sidebar start private, the safe default; the
        // "+" menu also offers a workspace agent.
        <CreateAgentButton visibility={'private'} />
      )}
    </>
  );
});

WorkspaceAgentListContent.displayName = 'WorkspaceAgentListContent';

export default WorkspaceAgentListContent;
