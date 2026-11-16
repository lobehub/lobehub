'use client';

import { cssVar, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { ChevronDown, ChevronUp, MoreHorizontal, PinIcon, UsersIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import CreateAgentButton from '../CreateAgentButton';
import { resolveAgentListContentState } from './agentListContentState';
import Group from './Group';
import InboxItem from './InboxItem';
import SessionList from './List';
import SortableList from './SortableList';
import { useWorkspaceAgentSections } from './useWorkspaceAgentSections';

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

  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
  const navigate = useWorkspaceAwareNavigate();
  const [teamExpanded, setTeamExpanded] = useState(false);
  // Team pins are shared by every member, so only owners/admins (the roles the
  // server lets write team pins) can reorder them; everyone orders their own.
  const { allowed: canManageTeamPins } = usePermission('manage_settings');
  const [reorderPinnedAgents, reorderMyPinned] = useHomeStore((s) => [
    s.reorderPinnedAgents,
    s.reorderMyPinned,
  ]);

  const resolved = useWorkspaceAgentSections();
  const { teamPinned } = resolved;
  const teamOverflow = teamPinned.length > TEAM_PINNED_VISIBLE_LIMIT;
  const visibleTeamPinned =
    teamOverflow && !teamExpanded ? teamPinned.slice(0, TEAM_PINNED_VISIBLE_LIMIT) : teamPinned;

  // While the team section is folded only its visible rows can move; the
  // folded ones keep their order after them.
  const handleReorderTeamPinned = useCallback(
    (ids: string[]) => {
      const moved = new Set(ids);
      return reorderPinnedAgents([
        ...ids,
        ...teamPinned.map((item) => item.id).filter((id) => !moved.has(id)),
      ]);
    },
    [reorderPinnedAgents, teamPinned],
  );
  const sections = useMemo(
    () => ({
      ...resolved,
      hasMore: resolved.rest.length > agentPageSize,
      rest: resolved.rest.slice(0, agentPageSize),
    }),
    [agentPageSize, resolved],
  );

  if (contentState !== 'ready')
    return (
      <>
        {!hideInbox && <InboxItem style={{ minHeight: 36 }} />}
        {contentState === 'loading' && <SkeletonList rows={3} />}
      </>
    );

  const { folders, hasMore, myPinned, rest } = sections;

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
          {canManageTeamPins ? (
            <SortableList dataSource={visibleTeamPinned} onReorder={handleReorderTeamPinned} />
          ) : (
            <SessionList dataSource={visibleTeamPinned} />
          )}
          {teamOverflow && (
            // Subordinate to the team pins above, so it reads lighter and
            // smaller than an agent row instead of competing with them.
            <NavItem
              data-testid={'sidebar-team-pinned-toggle'}
              icon={teamExpanded ? ChevronUp : ChevronDown}
              iconSize={14}
              titleColor={cssVar.colorTextDescription}
              title={
                <span style={{ fontSize: 12 }}>
                  {teamExpanded
                    ? t('navPanel.showLessTeamPinned')
                    : t('navPanel.showMoreTeamPinned', {
                        count: teamPinned.length - TEAM_PINNED_VISIBLE_LIMIT,
                      })}
                </span>
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
          <SortableList dataSource={myPinned} onReorder={reorderMyPinned} />
        </Flexbox>
      )}
      {folders.length > 0 && <Group dataSource={folders} />}
      {rest.length > 0 && (
        <Flexbox data-testid={'sidebar-agents-rest'} gap={1}>
          <SessionList dataSource={rest} />
        </Flexbox>
      )}
      {/* Shared folders and teammates' agents live on the Agents page, so
          the way there is always offered, not only when the list overflows. */}
      <NavItem
        icon={MoreHorizontal}
        title={hasMore ? t('input.more', { ns: 'chat' }) : t('navPanel.browseAllAgents')}
        onClick={() => navigate('/agents')}
      />
      {/* New agents from the sidebar start private, the safe default; the
          "+" menu also offers a workspace agent. */}
      <CreateAgentButton visibility={'private'} />
    </>
  );
});

WorkspaceAgentListContent.displayName = 'WorkspaceAgentListContent';

export default WorkspaceAgentListContent;
