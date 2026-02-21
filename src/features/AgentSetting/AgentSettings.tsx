import { Skeleton } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import { ChatSettingsTabs } from '@/store/global/initialState';
import { useServerConfigStore } from '@/store/serverConfig';

import AgentSettingsContent from './AgentSettingsContent';
import { AgentSettingsProvider } from './AgentSettingsProvider';
import { type StoreUpdaterProps } from './StoreUpdater';

export interface AgentSettingsProps extends StoreUpdaterProps {
  tab: ChatSettingsTabs;
}

const AgentSettings = memo<AgentSettingsProps>(({ tab = ChatSettingsTabs.Meta, ...rest }) => {
  const isMobile = useServerConfigStore((s) => s.isMobile);
  const loadingSkeleton = (
    <Skeleton active paragraph={{ rows: 6 }} style={{ padding: isMobile ? 16 : 0 }} title={false} />
  );

  return (
    <AgentSettingsProvider {...rest}>
      <Suspense fallback={loadingSkeleton}>
        <AgentSettingsContent loadingSkeleton={loadingSkeleton} tab={tab} />
      </Suspense>
    </AgentSettingsProvider>
  );
});

export default AgentSettings;
