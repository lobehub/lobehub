import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { AssistantNavKey } from '@/types/discover';

import ActionButton from './ActionButton';
import Related from './Related';
import Summary from './Summary';
import TocList from './TocList';

const Sidebar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { activeTab = AssistantNavKey.Overview } = useQuery() as { activeTab: AssistantNavKey };

  if (mobile) {
    return (
      <Flexbox gap={32}>
        <ActionButton mobile />
      </Flexbox>
    );
  }

  return (
    <ScrollShadow
      hideScrollBar
      flex={'none'}
      gap={32}
      size={4}
      width={360}
      style={{
        maxHeight: 'calc(100vh - 76px)',
        paddingBottom: 24,
        position: 'sticky',
        top: 16,
      }}
    >
      <ActionButton />
      {activeTab !== AssistantNavKey.Overview && <Summary />}
      {activeTab === AssistantNavKey.SystemRole && <TocList />}
      {activeTab !== AssistantNavKey.Related && <Related />}
    </ScrollShadow>
  );
});

export default Sidebar;
