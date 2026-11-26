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
import { liftInboxRow, withoutInboxInGroups } from './inboxRow';
import SessionList from './List';
import SortableList from './SortableList';
import { useWorkspaceAgentSections } from './useWorkspaceAgentSections';

/**
 * The merged workspace "Agents" section body (replacing the former separate
 * "Workspace" and "Private" accordions): Lobe AI → pinned → folders → the rest.
 * Pinned is the member's own list, which the workspace's default pins only
 * seed once (server side); the member moves or unpins any row in it, and
 * dragging never changes another member's order. Private rows carry a lock
 * icon wherever they appear. Personal mode keeps rendering
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
  const reorderMyPinned = useHomeStore((s) => s.reorderMyPinned);

  const hasInboxAgent = useHomeStore(homeAgentListSelectors.hasInboxAgent);
  const sectionsWithInbox = useWorkspaceAgentSections();
  // Lobe AI (the inbox) leads the sidebar wherever its row sits — a pin, a
  // folder or the rest — so it is taken out of the sections and rendered first.
  const { inboxItem, resolved } = useMemo(() => {
    const folders = withoutInboxInGroups(sectionsWithInbox.folders);
    const { inbox, lists } = liftInboxRow({
      pinned: sectionsWithInbox.pinned,
      rest: sectionsWithInbox.rest,
    });

    return {
      inboxItem: inbox ?? folders.inbox,
      resolved: { ...lists, folders: folders.groups },
    };
  }, [sectionsWithInbox]);
  const sections = useMemo(
    () => ({
      ...resolved,
      hasMore: resolved.rest.length > agentPageSize,
      rest: resolved.rest.slice(0, agentPageSize),
    }),
    [agentPageSize, resolved],
  );

  // Signed-in lists carry Lobe AI (the inbox) as an ordinary item from the
  // server, so it can be pinned, hidden and found again like any Agent. The
  // standalone entry covers the moments no list row exists: a signed-out
  // visitor, the first load, and a list cached or fetched before the inbox row.
  const showStandaloneInbox = !hideInbox && (contentState !== 'ready' || !hasInboxAgent);

  if (contentState === 'inbox') return showStandaloneInbox ? <InboxItem /> : null;
  if (contentState !== 'ready')
    return (
      <>
        {showStandaloneInbox && <InboxItem />}
        <SkeletonList rows={3} />
      </>
    );

  const { folders, hasMore, pinned, rest } = sections;

  return (
    <>
      {showStandaloneInbox && <InboxItem />}
      {inboxItem && <SessionList dataSource={[inboxItem]} />}
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
