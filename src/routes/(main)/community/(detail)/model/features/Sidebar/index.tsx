import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { ModelNavKey } from '@/types/discover';

import ActionButton from './ActionButton';
import Related from './Related';
import RelatedProviders from './RelatedProviders';

const Sidebar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { activeTab = ModelNavKey.Overview } = useQuery() as { activeTab: ModelNavKey };

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
      {activeTab !== ModelNavKey.Related && <Related />}
      {activeTab !== ModelNavKey.Overview && <RelatedProviders />}
    </ScrollShadow>
  );
});

export default Sidebar;
