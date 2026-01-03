import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useDiscoverStore } from '@/store/discover';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import { DetailProvider } from './DetailProvider';
import EmptyState from './EmptyState';
import Header from './Header';
import InstallDetail from './InstallDetail';
import DetailsLoading from './Loading';

const Detail = memo<{ identifier?: string }>(({ identifier: defaultIdentifier }) => {
  const [activeMCPIdentifier, isPluginListInit] = useToolStore((s) => [
    s.activePluginIdentifier,
    s.isPluginListInit,
  ]);

  const identifier = defaultIdentifier ?? activeMCPIdentifier;

  const isPluginInstalled = useToolStore(pluginSelectors.isPluginInstalled(identifier!));
  const usePluginDetail = useDiscoverStore((s) => s.usePluginDetail);

  const { data, isLoading } = usePluginDetail({ identifier });

  if (!isPluginListInit || isLoading) return <DetailsLoading />;

  return (
    <DetailProvider config={data}>
      <Flexbox gap={16}>
        <Header inModal />
        {isPluginInstalled ? <InstallDetail /> : <EmptyState />}
      </Flexbox>
    </DetailProvider>
  );
});

export default Detail;
