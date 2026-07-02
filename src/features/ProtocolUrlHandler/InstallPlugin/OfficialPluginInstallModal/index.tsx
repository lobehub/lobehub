'use client';

import { Block, Text } from '@lobehub/ui';
import { App } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import DetailLoading from '@/features/MCP/MCPDetail/Loading';
import { usePermission } from '@/hooks/usePermission';
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
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');

    // Fetch MCP plugin details
    const useMcpDetail = useDiscoverStore((s) => s.useFetchMcpDetail);
    const identifier = installRequest?.pluginId || '';

    const [installed, installMCPPlugin] = useToolStore((s) => [
      pluginSelectors.isPluginInstalled(identifier!)(s),

      s.installMCPPlugin,
    ]);
    const togglePlugin = useAgentStore((s) => s.togglePlugin);

    const { data, isLoading } = useMcpDetail({ identifier });

    const handleConfirm = useCallback(async () => {
      if (!canCreate || !canEdit || !installRequest || !data) return;

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
    }, [
      canCreate,
      canEdit,
      installRequest,
      data,
      installMCPPlugin,
      identifier,
      togglePlugin,
      message,
      t,
      onComplete,
    ]);

    if (!installRequest) return null;

    // Render content
    const renderContent = () => {
      // If loading, show skeleton screen
      if (isLoading || !identifier) {
        return <DetailLoading />;
      }

      // If loading failed or no data, show error message
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
      <ImperativeModal
        open
        confirmLoading={loading}
        title={t('protocolInstall.official.title')}
        width={800}
        okButtonProps={{
          disabled: installed || isLoading || !canCreate || !canEdit,
          type: installed ? 'default' : 'primary',
        }}
        okText={
          installed ? t('protocolInstall.actions.installed') : t('protocolInstall.actions.install')
        }
        onCancel={onComplete}
        onOk={handleConfirm}
      >
        {renderContent()}
      </ImperativeModal>
    );
  },
);

OfficialPluginInstallModal.displayName = 'OfficialPluginInstallModal';

export default OfficialPluginInstallModal;
