'use client';

import { memo, useMemo } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { SessionDefaultGroup } from '@/types/index';

import SkeletonList from '../../../../../../../../features/NavPanel/components/SkeletonList';
import AllAgentsDrawer from '../AllAgentsDrawer';
import Group from './Group';
import InboxItem from './InboxItem';
import SessionList from './List';
import { useAgentList } from './useAgentList';

const AgentList = memo<{ onMoreClick?: () => void }>(({ onMoreClick }) => {
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const { customList, pinnedList, defaultList } = useAgentList();

  const [allAgentsDrawerOpen, closeAllAgentsDrawer] = useHomeStore((s) => [
    s.allAgentsDrawerOpen,
    s.closeAllAgentsDrawer,
  ]);

  useFetchAgentList();

  // Memoize computed visibility flags to prevent unnecessary recalculations
  const { showPinned, showCustom, showDefault } = useMemo(() => {
    const hasPinned = Boolean(pinnedList?.length);
    const hasCustom = Boolean(customList?.length);
    const hasDefault = Boolean(defaultList?.length);

    return {
      showCustom: hasCustom,
      showDefault: hasDefault,
      showPinned: hasPinned,
    };
  }, [pinnedList?.length, customList?.length, defaultList?.length]);

  if (!isInit) return <SkeletonList rows={6} />;

  return (
    <>
      <InboxItem style={{ minHeight: 36 }} />
      {showPinned && <SessionList dataSource={pinnedList!} />}
      {showCustom && <Group dataSource={customList!} />}
      {showDefault && (
        <SessionList
          dataSource={defaultList!}
          groupId={SessionDefaultGroup.Default}
          onMoreClick={onMoreClick}
        />
      )}
      <AllAgentsDrawer open={allAgentsDrawerOpen} onClose={closeAllAgentsDrawer} />
    </>
  );
});

export default AgentList;
