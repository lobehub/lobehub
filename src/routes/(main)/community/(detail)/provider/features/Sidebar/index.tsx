import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { ProviderNavKey } from '@/types/discover';

import ActionButton from './ActionButton';
import Related from './Related';
import RelatedModels from './RelatedModels';

const Sidebar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { activeTab = ProviderNavKey.Overview } = useQuery() as { activeTab: ProviderNavKey };

  if (mobile) {
    return (
      <Flexbox gap={32}>
        <ActionButton />
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
      {activeTab !== ProviderNavKey.Related && <Related />}
      {activeTab !== ProviderNavKey.Overview && <RelatedModels />}
    </ScrollShadow>
  );
});

export default Sidebar;
