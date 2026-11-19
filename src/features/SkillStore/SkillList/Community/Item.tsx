'use client';

import {
  ActionIcon,
  Block,
  Button,
  confirmModal,
  createModal,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
  toast,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { t as translate } from 'i18next';
import { MoreHorizontalIcon, Plus, Settings2, Trash2 } from 'lucide-react';
import React, { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import MCPTag from '@/components/Plugins/MCPTag';
import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { installedMcpSelection } from '@/features/CommunityMcp/installedMcpSelection';
import McpDetail from '@/features/MCP/MCPDetail';
import McpDetailLoading from '@/features/MCP/MCPDetail/Loading';
import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { discoverService } from '@/services/discover';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { type DiscoverMcpItem } from '@/types/discover';
import { isModifierClick } from '@/utils/navigation';

import { itemStyles } from '../style';

const openSkillDetailModal = (
  identifier: string,
  title = translate('dev.title.skillDetails', { ns: 'plugin' }),
) =>
  createModal({
    content: (
      <Suspense fallback={<McpDetailLoading />}>
        <McpDetail noSettings identifier={identifier} />
      </Suspense>
    ),
    footer: null,
    title,
    width: 'min(92vw, 800px)',
  });

const Item = memo<DiscoverMcpItem & { marketplace?: boolean }>((props) => {
  const { name, description, icon, identifier, marketplace } = props;
  const styles = itemStyles;
  const { t } = useTranslation('plugin');
  const navigate = useWorkspaceAwareNavigate();
  const detailPath = '/community/mcp/' + identifier;
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const [installed, installing, installMCPPlugin, cancelInstallMCPPlugin, unInstallPlugin, plugin] =
    useToolStore((s) => [
      pluginSelectors.isPluginInstalled(identifier)(s),
      mcpStoreSelectors.isMCPInstalling(identifier)(s),
      s.installMCPPlugin,
      s.cancelInstallMCPPlugin,
      s.uninstallMCPPlugin,
      mcpStoreSelectors.getPluginById(identifier)(s),
    ]);

  // Undefined for a connector-backed install, which has no plugin row.
  const legacyType = useToolStore((s) => {
    const row = pluginSelectors.installedPlugins(s).find((i) => i.identifier === identifier);
    return row && (row.source || row.type);
  });

  const installProgress = useToolStore(
    mcpStoreSelectors.getMCPInstallProgress(identifier),
    isEqual,
  );

  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);
  const { isAuthenticated, signIn } = useMarketAuth();

  const isCloudMcp = !!((plugin as any)?.cloudEndPoint || (plugin as any)?.haveCloudEndpoint);

  const handleInstall = async () => {
    if (!canCreate || !canEdit) return;
    if (isCloudMcp && !isAuthenticated) {
      try {
        await signIn('mcp');
      } catch {
        return;
      }
    }

    try {
      const isSuccess = await installMCPPlugin(identifier);
      if (isSuccess && !marketplace) await togglePlugin(identifier);
    } catch {
      toast.error(t('error.installError', { name }));
    }
  };

  const handleCancel = async () => {
    await cancelInstallMCPPlugin(identifier);
  };

  const openDetail = () => {
    if (!marketplace) {
      openSkillDetailModal(identifier);
      return;
    }

    void discoverService
      .reportMcpEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    openSkillDetailModal(identifier, t('store.actions.detail'));
  };

  const renderAction = () => {
    if (marketplace && installed)
      return (
        <ActionIcon
          aria-label={t('store.actions.settings')}
          icon={Settings2}
          title={t('store.actions.settings')}
          onClick={() => {
            const params = new URLSearchParams(location.search);
            params.set('open', installedMcpSelection(identifier, legacyType));
            navigate({ search: params.toString() });
          }}
        />
      );

    if (installed) {
      return (
        <DropdownMenu
          nativeButton={false}
          placement="bottomRight"
          items={[
            {
              danger: true,
              disabled: !canEdit,
              icon: <Icon icon={Trash2} />,
              key: 'uninstall',
              label: t('store.actions.uninstall'),
              onClick: () => {
                if (!canEdit) return;
                confirmModal({
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    if (isPluginEnabledInAgent) {
                      await togglePlugin(identifier, false);
                    }
                    await unInstallPlugin(identifier);
                  },
                  content: t('store.actions.confirmUninstall'),
                  okText: t('store.actions.uninstall'),
                  title: t('store.actions.uninstall'),
                });
              },
            },
          ]}
        >
          <ActionIcon
            aria-label={t('connectorMarket.action.manage', { ns: 'setting' })}
            icon={MoreHorizontalIcon}
          />
        </DropdownMenu>
      );
    }

    if (installing) {
      return (
        <Button size="small" type="fill" onClick={handleCancel}>
          {t('store.actions.cancel')}
        </Button>
      );
    }

    return (
      <ActionIcon
        aria-label={t('store.actions.install')}
        disabled={!canCreate || !canEdit}
        icon={Plus}
        title={t('store.actions.install')}
        onClick={handleInstall}
      />
    );
  };

  return (
    <Flexbox
      className={styles.container}
      data-testid={marketplace ? 'mcp-item' : undefined}
      gap={0}
    >
      <Block
        clickable
        horizontal
        align={'center'}
        gap={12}
        paddingBlock={marketplace ? 8 : 12}
        paddingInline={12}
        variant={marketplace ? 'filled' : 'outlined'}
        onClick={openDetail}
      >
        <PluginAvatar avatar={icon} size={marketplace ? 36 : 40} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Flexbox horizontal align="center" gap={8}>
            {marketplace ? (
              <WorkspaceLink
                aria-haspopup="dialog"
                className={styles.title}
                to={detailPath}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isModifierClick(event) || event.shiftKey || event.altKey) return;

                  event.preventDefault();
                  openDetail();
                }}
              >
                {name}
              </WorkspaceLink>
            ) : (
              <>
                <span className={styles.title}>{name}</span>
                <MCPTag showText={false} />
              </>
            )}
          </Flexbox>
          {description && <span className={styles.description}>{description}</span>}
        </Flexbox>
        <div onClick={stopPropagation}>{renderAction()}</div>
      </Block>

      {!!installProgress && (
        <Flexbox paddingInline={12}>
          <MCPInstallProgress identifier={identifier} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

Item.displayName = 'CommunityListItem';

export default Item;
