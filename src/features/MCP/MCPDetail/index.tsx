import { Center, Empty, Flexbox } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Boxes } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Agents from '@/features/MCPPluginDetail/Agents';
import Deployment from '@/features/MCPPluginDetail/Deployment';
import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Header from '@/features/MCPPluginDetail/Header';
import Nav from '@/features/MCPPluginDetail/Nav';
import Overview from '@/features/MCPPluginDetail/Overview';
import Schema from '@/features/MCPPluginDetail/Schema';
import Score from '@/features/MCPPluginDetail/Score';
import { useDiscoverStore } from '@/store/discover';
import { useToolStore } from '@/store/tool';
import { McpNavKey } from '@/types/discover';

import Settings from '../MCPSettings';
import Loading from './Loading';

interface DetailProps {
  defaultTab?: McpNavKey;
  identifier?: string;
  noSettings?: boolean;
}
const Detail = memo<DetailProps>(({ identifier: defaultIdentifier, defaultTab, noSettings }) => {
  const [activeTab, setActiveTab] = useState(defaultTab ?? McpNavKey.Overview);
  const { t } = useTranslation('plugin');

  const theme = useTheme(); // Keep for colorBgContainerSecondary (not in cssVar)
  const [activeMCPIdentifier, isMcpListInit] = useToolStore((s) => [
    s.activeMCPIdentifier,
    s.isMcpListInit,
  ]);

  const identifier = defaultIdentifier ?? activeMCPIdentifier;

  const useMcpDetail = useDiscoverStore((s) => s.useFetchMcpDetail);
  const { data, isLoading } = useMcpDetail({ identifier });

  // 如果有明确传入的 identifier，跳过 isMcpListInit 检查
  const shouldWaitForInit = !defaultIdentifier && !isMcpListInit;
  if (shouldWaitForInit || isLoading) return <Loading />;

  if (!identifier)
    return (
      <Center
        height={'100%'}
        width={'100%'}
        style={{
          background: theme.colorBgContainerSecondary,
        }}
      >
        <Empty
          description={t('store.emptySelectHint')}
          descriptionProps={{ fontSize: 14 }}
          icon={Boxes}
          style={{ maxWidth: 400 }}
        />
      </Center>
    );

  return (
    <DetailProvider config={data}>
      <Flexbox gap={16}>
        <Header inModal />
        <Nav
          inModal
          activeTab={activeTab as McpNavKey}
          noSettings={noSettings}
          setActiveTab={setActiveTab}
        />
        <Flexbox gap={24}>
          {activeTab === McpNavKey.Settings && <Settings identifier={identifier} />}
          {activeTab === McpNavKey.Overview && <Overview inModal />}
          {activeTab === McpNavKey.Deployment && <Deployment />}
          {activeTab === McpNavKey.Schema && <Schema />}
          {activeTab === McpNavKey.Score && <Score />}
          {activeTab === McpNavKey.Agents && <Agents inModal />}
        </Flexbox>
      </Flexbox>
    </DetailProvider>
  );
});

export default Detail;
