'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors } from '@/store/tool/selectors';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

interface MarketMcpInstallActionsProps {
  actionLabel?: string;
  haveCloudEndpoint?: boolean;
  identifier?: string;
}

export const MarketMcpInstallActions = ({
  actionLabel,
  haveCloudEndpoint,
  identifier,
}: MarketMcpInstallActionsProps) => {
  const { t } = useTranslation(['discover', 'plugin']);
  const [isLoading, setIsLoading] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { isAuthenticated, isLoading: isAuthLoading, signIn } = useMarketAuth();

  const [installed, installMCPPlugin, uninstallMCPPlugin] = useToolStore((s) => [
    pluginSelectors.isPluginInstalled(identifier ?? '')(s),
    s.installMCPPlugin,
    s.uninstallMCPPlugin,
  ]);

  const installing = useToolStore(mcpStoreSelectors.isMCPInstalling(identifier ?? ''));

  const installPlugin = async () => {
    if (!identifier || !canCreate || !canEdit || isLoading || installing) return;
    setIsLoading(true);
    try {
      if (haveCloudEndpoint && !isAuthenticated) {
        try {
          await signIn('mcp');
        } catch {
          return;
        }
      }
      await installMCPPlugin(identifier);
    } finally {
      setIsLoading(false);
    }
  };

  if (!identifier) return null;

  const buttonLoading = isLoading || isAuthLoading || installing;

  return installed ? (
    <Flexbox horizontal gap={8}>
      <Button block disabled={buttonLoading} size={'large'} type={'default'}>
        {t('plugins.installed')}
      </Button>

      <Button
        disabled={!canEdit}
        icon={<Icon icon={Trash2Icon} size={20} />}
        loading={buttonLoading}
        size={'large'}
        style={{ minWidth: 45 }}
        title={t('plugin:store.actions.uninstall')}
        styles={{
          icon: { height: 20 },
        }}
        onClick={async () => {
          if (!canEdit) return;
          setIsLoading(true);
          try {
            await uninstallMCPPlugin(identifier);
          } finally {
            setIsLoading(false);
          }
        }}
      />
    </Flexbox>
  ) : (
    <>
      <Button
        block
        disabled={!canCreate || !canEdit}
        loading={buttonLoading}
        size={'large'}
        type={'primary'}
        onClick={installPlugin}
      >
        {actionLabel ?? t('plugins.install')}
      </Button>
      <MCPInstallProgress identifier={identifier} />
    </>
  );
};
