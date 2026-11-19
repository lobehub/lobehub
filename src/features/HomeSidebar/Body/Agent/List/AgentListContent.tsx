'use client';

import { memo, useCallback, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { SessionDefaultGroup } from '@/types/index';

import { resolveAgentListContentState } from './agentListContentState';
import Group from './Group';
import InboxItem from './InboxItem';
import SessionList from './List';
import SortableList from './SortableList';
import { useAgentList } from './useAgentList';

interface AgentListContentProps {
  hideInbox?: boolean;
  onMoreClick?: () => void;
}

// Keep this drawer-free so compact switchers can reuse the list without
// coupling to Home drawer state. Renders only workspace-public content;
// private items live in the sibling `Private` accordion section so
// workspace-shared and personal agents stay visually distinct.
//
// SWR subscription is owned by the enclosing accordion (Body/Agent/index.tsx)
// or by a standalone caller (e.g. SwitchPanel). Subscribing here too would
// re-fetch the list every time the accordion is expanded, animating the
// spinner on both Public and Private headers for no good reason.
const AgentListContent = memo<AgentListContentProps>(({ hideInbox, onMoreClick }) => {
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const authLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const contentState = resolveAgentListContentState({
    authLoaded: !!authLoaded,
    isInit,
    isLogin: !!isLogin,
  });
  const { customList, pinnedList, defaultList } = useAgentList();
  // Personal pins are the user's own, so they can always be reordered. A
  // workspace caller (compact switchers) gets the team pins here, whose order
  // only owners/admins may change from the sidebar's own section.
  const isWorkspace = !!useActiveWorkspaceId();
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents);
  const reorderPinnedAgents = useHomeStore((s) => s.reorderPinnedAgents);

  // Pins hidden from the sidebar keep their place after the visible ones.
  const handleReorderPinned = useCallback(
    (ids: string[]) => {
      const moved = new Set(ids);
      return reorderPinnedAgents([
        ...ids,
        ...pinnedAgents.map((item) => item.id).filter((id) => !moved.has(id)),
      ]);
    },
    [pinnedAgents, reorderPinnedAgents],
  );

  // Memoize computed visibility flags to prevent unnecessary recalculations
  const { showPinned, showCustom } = useMemo(() => {
    const hasPinned = Boolean(pinnedList?.length);
    const hasCustom = Boolean(customList?.length);

    return {
      showCustom: hasCustom,
      showPinned: hasPinned,
    };
  }, [pinnedList?.length, customList?.length]);

  if (contentState !== 'ready')
    return (
      <>
        {!hideInbox && <InboxItem />}
        {contentState === 'loading' && <SkeletonList rows={3} />}
      </>
    );

  // Always render the default SessionList so the "+ Create Agent" entry is visible
  // even when the user has only the built-in Lobe AI inbox.
  return (
    <>
      {!hideInbox && <InboxItem />}
      {showPinned &&
        (isWorkspace ? (
          <SessionList dataSource={pinnedList!} />
        ) : (
          <SortableList dataSource={pinnedList!} onReorder={handleReorderPinned} />
        ))}
      {showCustom && <Group dataSource={customList!} />}
      <SessionList
        dataSource={defaultList ?? []}
        groupId={SessionDefaultGroup.Default}
        onMoreClick={onMoreClick}
      />
    </>
  );
});

AgentListContent.displayName = 'AgentListContent';

export default AgentListContent;
