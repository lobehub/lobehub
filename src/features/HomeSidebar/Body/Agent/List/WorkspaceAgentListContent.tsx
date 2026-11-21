'use client';

import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
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

/**
 * The merged workspace "Agents" section body (replacing the former separate
 * "Workspace" and "Private" accordions): Inbox → pinned → folders → the rest.
 * Pinned is one list the member arranges themselves: their own pins and the
 * team pins owners/admins recommend, which carry a team icon and which the
 * member may move or unpin like any other (see `resolveWorkspaceAgentSections`
 * for the default order). Dragging only changes the member's own order, never
 * the team's. Private rows carry a lock icon wherever they appear. Personal
 * mode keeps rendering `AgentListContent`.
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
  const reorderMyPinned = useHomeStore((s) => s.reorderMyPinned);

  const resolved = useWorkspaceAgentSections();
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
        {!hideInbox && <InboxItem />}
        {contentState === 'loading' && <SkeletonList rows={3} />}
      </>
    );

  const { folders, hasMore, pinned, rest } = sections;

  return (
    <>
      {!hideInbox && <InboxItem />}
      {pinned.length > 0 && (
        <Flexbox data-testid={'sidebar-pinned'} gap={1}>
          <SortableList dataSource={pinned} onReorder={reorderMyPinned} />
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
