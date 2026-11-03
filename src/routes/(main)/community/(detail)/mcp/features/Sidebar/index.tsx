import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { isDesktop } from '@/const/version';
import { useQuery } from '@/hooks/useQuery';
import { McpNavKey } from '@/types/discover';

import ActionButton from './ActionButton';
import ConnectionTypeAlert from './ConnectionTypeAlert';
import Related from './Related';
import ServerConfig from './ServerConfig';
import TocList from './TocList';

const Sidebar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { activeTab = McpNavKey.Overview } = useQuery() as { activeTab: McpNavKey };

  if (mobile) {
    if (activeTab !== McpNavKey.Overview) return;
    return (
      <Flexbox gap={32}>
        <ConnectionTypeAlert />
        <ServerConfig />
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
      {isDesktop ? (
        <Flexbox>
          <ActionButton />
        </Flexbox>
      ) : (
        <ConnectionTypeAlert />
      )}
      {activeTab !== McpNavKey.Deployment && <ServerConfig />}
      <TocList />
      {![McpNavKey.Overview, McpNavKey.Schema, McpNavKey.Related].includes(activeTab) && (
        <Related />
      )}
    </ScrollShadow>
  );
});

export default Sidebar;
