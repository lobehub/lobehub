'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { VList } from 'virtua';

import AgentSelectionEmpty from '@/features/AgentSelectionEmpty';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import GroupItem from '../List/AgentGroupItem';
import AgentItem from '../List/AgentItem';

interface ContentProps {
  open: boolean;
  searchKeyword: string;
}

const Content = memo<ContentProps>(({ searchKeyword }) => {
  // Use server-side search if there's a keyword
  const trimmedKeyword = searchKeyword.trim();
  const isSearching = trimmedKeyword.length > 0;

  // Search agents using homeStore
  const [useSearchAgents] = useHomeStore((s) => [s.useSearchAgents]);
  const { data: searchResults, isLoading: isSearchLoading } = useSearchAgents(
    isSearching ? trimmedKeyword : undefined,
  );

  // Get all agents from homeStore (ungrouped agents for default view)
  const allUngroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);

  // Filter and display - searchResults already returns SidebarAgentItem[]
  const displayItems = isSearching ? searchResults || [] : allUngroupedAgents;

  const count = displayItems.length;

  // Show loading skeleton when searching
  if (isSearching && (isSearchLoading || !searchResults)) {
    return (
      <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
        <SkeletonList rows={5} />
      </Flexbox>
    );
  }

  // Show empty state when no agents
  if (count === 0) {
    return <AgentSelectionEmpty search={isSearching} />;
  }

  return (
    <VList
      bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
      style={{ height: '100%' }}
    >
      {displayItems.map((item) => (
        <Flexbox key={item.id} paddingBlock={1} paddingInline={4}>
          {item.type === 'group' ? <GroupItem item={item} /> : <AgentItem item={item} />}
        </Flexbox>
      ))}
    </VList>
  );
});

Content.displayName = 'AllAgentsDrawerContent';

export default Content;
