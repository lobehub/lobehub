'use client';

import { Block, Modal, Text } from '@lobehub/ui';
import { App } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DetailLoading from '@/features/MCP/MCPDetail/Loading';
import { useAgentStore } from '@/store/agent';
import { useDiscoverStore } from '@/store/discover';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

import { type McpInstallRequest } from '../types';
import OfficialDetail from './Detail';

interface OfficialPluginInstallModalProps {
  installRequest: McpInstallRequest | null;
  onComplete: () => void;
}

const OfficialPluginInstallModal = memo<OfficialPluginInstallModalProps>(
  ({ installRequest, onComplete }) => {
    const { message } = App.useApp();
    const { t } = useTranslation(['plugin', 'common']);
    const [loading, setLoading] = useState(false);

    // 获取 MCP 插件详情
    const useMcpDetail = useDiscoverStore((s) => s.useFetchMcpDetail);
    const identifier = installRequest?.pluginId || '';

    const [installed, installMCPPlugin] = useToolStore((s) => [
      pluginSelectors.isPluginInstalled(identifier!)(s),

      s.installMCPPlugin,
    ]);
    const togglePlugin = useAgentStore((s) => s.togglePlugin);

    const { data, isLoading } = useMcpDetail({ identifier });

    const handleConfirm = useCallback(async () => {
      if (!installRequest || !data) return;

      setLoading(true);
      try {
        setLoading(true);
        await installMCPPlugin(identifier);
        await togglePlugin(identifier);
        setLoading(false);

        message.success(t('protocolInstall.messages.installSuccess', { name: data.name }));
        onComplete();
      } catch (error) {
        console.error('Official plugin installation error:', error);
        message.error(t('protocolInstall.messages.installError'));
        setLoading(false);
      }
    }, [installRequest, data]);

    if (!installRequest) return null;

    // 渲染内容
    const renderContent = () => {
      // 如果正在加载，显示骨架屏
      if (isLoading || !identifier) {
        return <DetailLoading />;
      }

      // 如果加载失败或没有数据，显示错误信息
      if (!data) {
        return (
          <Block>
            <Text type="danger">{t('protocolInstall.messages.manifestError')}</Text>
          </Block>
        );
      }

      return <OfficialDetail data={data} identifier={identifier} />;
    };

    return (
      <Modal
        open
        confirmLoading={loading}
        title={t('protocolInstall.official.title')}
        width={800}
        okButtonProps={{
          disabled: installed || isLoading,
          type: installed ? 'default' : 'primary',
        }}
        okText={
          installed ? t('protocolInstall.actions.installed') : t('protocolInstall.actions.install')
        }
        onCancel={onComplete}
        onOk={handleConfirm}
      >
        {renderContent()}
      </Modal>
    );
  },
);

OfficialPluginInstallModal.displayName = 'OfficialPluginInstallModal';

export default OfficialPluginInstallModal;
