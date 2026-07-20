'use client';

import { exportJSONFile } from '@lobechat/utils/client';
import { ActionIcon, Flexbox, Icon, Tag } from '@lobehub/ui';
import { confirmModal, type DropdownItem, DropdownMenu, Switch } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import {
  BookOpen,
  Download,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { useAgentStore } from '@/store/agent';
import type { BotProviderItem } from '@/store/agent/slices/bot/action';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '../../../../types/botRuntimeStatus';

interface HeaderProps {
  agentId: string;
  currentConfig?: BotProviderItem;
  disabled?: boolean;
  platformDef?: SerializedPlatformDefinition & { comingSoon?: boolean };
  providers?: BotProviderItem[];
  runtimeStatus?: BotRuntimeStatus;
}

const STATUS_TAG_COLORS: Partial<Record<BotRuntimeStatus, string>> = {
  [BOT_RUNTIME_STATUSES.connected]: 'success',
  [BOT_RUNTIME_STATUSES.dormant]: 'warning',
  [BOT_RUNTIME_STATUSES.failed]: 'error',
  [BOT_RUNTIME_STATUSES.queued]: 'processing',
  [BOT_RUNTIME_STATUSES.starting]: 'processing',
};

const Header = memo<HeaderProps>(
  ({ agentId, currentConfig, disabled, platformDef, providers, runtimeStatus }) => {
    const { t } = useTranslation(['agent', 'chat', 'common']);
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingEnabled, setPendingEnabled] = useState<boolean>();
    const [refreshingStatus, setRefreshingStatus] = useState(false);
    const [toggleLoading, setToggleLoading] = useState(false);
    const [
      connectBot,
      createBotProvider,
      deleteAllBotProviders,
      refreshBotRuntimeStatus,
      updateBotProvider,
    ] = useAgentStore((s) => [
      s.connectBot,
      s.createBotProvider,
      s.deleteAllBotProviders,
      s.refreshBotRuntimeStatus,
      s.updateBotProvider,
    ]);

    const paidFeatureBlocked =
      platformDef?.access?.requiredPlan === 'paid' && platformDef.access.allowed === false;
    const writeDisabled = disabled || paidFeatureBlocked;
    const toggleDisabled = disabled || (paidFeatureBlocked && !currentConfig?.enabled);
    const effectiveEnabled = pendingEnabled ?? currentConfig?.enabled;
    const hasProviders = !!providers?.length;

    useEffect(() => {
      if (!currentConfig || pendingEnabled === currentConfig.enabled) setPendingEnabled(undefined);
    }, [currentConfig, pendingEnabled]);

    const handleExport = useCallback(() => {
      if (!providers?.length) return;
      const exportData = providers.map(({ id: _, ...rest }) => rest);
      exportJSONFile(exportData, `lobehub-channels-${agentId}.json`);
    }, [agentId, providers]);

    const handleImport = useCallback(() => {
      if (disabled) return;
      fileInputRef.current?.click();
    }, [disabled]);

    const handleFileChange = useCallback(
      async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (disabled || !file) {
          event.target.value = '';
          return;
        }

        try {
          const data = JSON.parse(await file.text());
          if (
            !Array.isArray(data) ||
            data.some((item) => !item.platform || !item.applicationId || !item.credentials)
          ) {
            message.error(t('channel.importInvalidFormat'));
            return;
          }

          for (const item of data) {
            await createBotProvider({
              agentId,
              applicationId: item.applicationId,
              credentials: item.credentials,
              platform: item.platform,
              settings: item.settings ?? undefined,
            });
            if (item.enabled) {
              await connectBot({
                agentId,
                applicationId: item.applicationId,
                platform: item.platform,
              });
            }
          }

          message.success(t('channel.importSuccess'));
        } catch {
          message.error(t('channel.importFailed'));
        } finally {
          event.target.value = '';
        }
      },
      [agentId, connectBot, createBotProvider, disabled, message, t],
    );

    const handleDeleteAll = useCallback(() => {
      if (disabled || !providers?.length) return;
      confirmModal({
        content: t('channel.deleteAllConfirmDesc'),
        okButtonProps: { danger: true },
        okText: t('channel.deleteAllChannels'),
        onOk: async () => {
          try {
            await deleteAllBotProviders(agentId);
            message.success(t('channel.deleteAllSuccess'));
          } catch {
            message.error(t('channel.deleteAllFailed'));
          }
        },
        title: t('channel.deleteAllConfirm'),
      });
    }, [agentId, deleteAllBotProviders, disabled, message, providers, t]);

    const handleRefreshStatus = useCallback(async () => {
      if (writeDisabled || !currentConfig?.enabled) return;
      setRefreshingStatus(true);
      try {
        await refreshBotRuntimeStatus({
          agentId,
          applicationId: currentConfig.applicationId,
          platform: currentConfig.platform,
        });
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setRefreshingStatus(false);
      }
    }, [agentId, currentConfig, message, refreshBotRuntimeStatus, writeDisabled]);

    const handleToggleEnable = useCallback(
      async (enabled: boolean) => {
        if ((enabled ? writeDisabled : disabled) || !currentConfig) return;
        try {
          setPendingEnabled(enabled);
          setToggleLoading(true);
          await updateBotProvider(currentConfig.id, agentId, { enabled });
          if (enabled) {
            await connectBot({
              agentId,
              applicationId: currentConfig.applicationId,
              platform: currentConfig.platform,
            });
          }
        } catch {
          setPendingEnabled(undefined);
          message.error(t('channel.updateFailed'));
        } finally {
          setToggleLoading(false);
        }
      },
      [agentId, connectBot, currentConfig, disabled, message, t, updateBotProvider, writeDisabled],
    );

    const statusLabel = (() => {
      switch (runtimeStatus) {
        case BOT_RUNTIME_STATUSES.connected: {
          return t('channel.statusConnected');
        }
        case BOT_RUNTIME_STATUSES.failed: {
          return t('channel.statusFailed');
        }
        case BOT_RUNTIME_STATUSES.queued: {
          return t('channel.statusQueued');
        }
        case BOT_RUNTIME_STATUSES.starting: {
          return t('channel.statusStarting');
        }
        case BOT_RUNTIME_STATUSES.dormant: {
          return t('channel.statusDormant');
        }
        case BOT_RUNTIME_STATUSES.disconnected: {
          return t('channel.statusDisconnected');
        }
        default: {
          return undefined;
        }
      }
    })();
    const menuItems: DropdownItem[] = [];

    if (platformDef?.documentation?.setupGuideUrl) {
      menuItems.push({
        icon: <Icon icon={BookOpen} />,
        key: 'docs',
        label: t('channel.documentation'),
        onClick: () =>
          window.open(platformDef.documentation?.setupGuideUrl, '_blank', 'noopener,noreferrer'),
      });
    }
    if (platformDef?.documentation?.portalUrl) {
      menuItems.push({
        icon: <Icon icon={ExternalLink} />,
        key: 'open-platform',
        label: t('channel.openPlatform'),
        onClick: () =>
          window.open(platformDef.documentation?.portalUrl, '_blank', 'noopener,noreferrer'),
      });
    }
    if (menuItems.length > 0) menuItems.push({ type: 'divider' });
    menuItems.push(
      {
        disabled: !hasProviders,
        icon: <Icon icon={Download} />,
        key: 'export',
        label: t('channel.exportConfig'),
        onClick: handleExport,
      },
      {
        disabled,
        icon: <Icon icon={Upload} />,
        key: 'import',
        label: t('channel.importConfig'),
        onClick: handleImport,
      },
      { type: 'divider' },
      {
        danger: true,
        disabled: disabled || !hasProviders,
        icon: <Icon icon={Trash2} />,
        key: 'delete-all',
        label: t('channel.deleteAllChannels'),
        onClick: handleDeleteAll,
      },
    );

    return (
      <>
        <input
          accept=".json"
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          onChange={handleFileChange}
        />
        <NavHeader
          left={
            <AgentBreadcrumb
              agentId={agentId}
              extraItems={platformDef ? [platformDef.name] : undefined}
              title={
                platformDef ? (
                  <Link relative="path" to="..">
                    {t('tab.integration', { ns: 'chat' })}
                  </Link>
                ) : (
                  t('tab.integration', { ns: 'chat' })
                )
              }
            />
          }
          right={
            <Flexbox horizontal align="center" gap={8}>
              {platformDef?.comingSoon && <Tag size={'small'}>{t('channel.comingSoon')}</Tag>}
              {platformDef?.access?.requiredPlan === 'paid' && (
                <Tag color="gold" size={'small'}>
                  {platformDef.access.rolloutMode === 'notice'
                    ? t('channel.paidFeature.noticeBadge')
                    : t('channel.paidFeature.badge')}
                </Tag>
              )}
              {statusLabel && (
                <Tag
                  color={runtimeStatus ? STATUS_TAG_COLORS[runtimeStatus] : undefined}
                  size={'small'}
                >
                  {statusLabel}
                </Tag>
              )}
              {currentConfig?.enabled && (
                <ActionIcon
                  disabled={writeDisabled}
                  icon={RefreshCw}
                  loading={refreshingStatus}
                  size={'small'}
                  title={t('channel.refreshStatus')}
                  onClick={handleRefreshStatus}
                />
              )}
              {currentConfig && (
                <Switch
                  checked={effectiveEnabled}
                  disabled={toggleDisabled}
                  loading={toggleLoading}
                  onChange={handleToggleEnable}
                />
              )}
              <DropdownMenu items={menuItems} placement={'bottomRight'}>
                <ActionIcon icon={MoreHorizontal} title={t('more', { ns: 'common' })} />
              </DropdownMenu>
            </Flexbox>
          }
          styles={{
            left: { minWidth: 0, paddingInlineStart: 8 },
          }}
        />
      </>
    );
  },
);

Header.displayName = 'AgentChannelHeader';

export default Header;
