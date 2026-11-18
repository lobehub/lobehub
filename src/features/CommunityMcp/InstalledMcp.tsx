import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import { encodeMobileSelection } from '@/features/Settings/skill/mobileSelection';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { isLegacyMcp } from './isLegacyMcp';

export const InstalledMcp = () => {
  const { t } = useTranslation('discover');
  const [query] = useSearchParams();
  const useConnectors = useToolStore((s) => s.useFetchConnectors);
  const usePlugins = useToolStore((s) => s.useFetchInstalledPlugins);
  const connectorSync = useConnectors(true);
  const pluginSync = usePlugins(true);
  const plugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual).filter(
    isLegacyMcp,
  );
  const connectors = useToolStore(connectorSelectors.userMcpConnectors, isEqual);
  const connectorIds = new Set(connectors.map((item) => item.identifier));
  const entries = [
    ...connectors.map((item) => ({
      avatar: item.metadata?.avatar as string | undefined,
      identifier: item.identifier,
      selection: 'mcp-connector' as const,
      title: item.name,
    })),
    ...plugins
      .filter((item) => !connectorIds.has(item.identifier))
      .map((item) => ({
        avatar: item.avatar,
        identifier: item.identifier,
        selection: item.type === 'customPlugin' ? ('mcp-connector' as const) : ('plugin' as const),
        title: item.title,
      })),
  ];

  return (
    <Flexbox gap={2} padding={8}>
      <Text as="h2" fontSize={12} type="secondary">
        {t('plugins.installed')}
      </Text>
      {entries.map(({ identifier, selection, title, avatar }) => {
        const value = encodeMobileSelection({ identifier, type: selection });
        return (
          <WorkspaceLink key={value} to={'/community/mcp?' + new URLSearchParams({ open: value })}>
            <NavItem
              active={query.get('open') === value}
              title={title || identifier}
              icon={() =>
                avatar && avatar !== 'MCP_AVATAR' ? (
                  <Avatar avatar={avatar} shape="square" size={18} />
                ) : (
                  <Icon icon={McpIcon} size={18} />
                )
              }
            />
          </WorkspaceLink>
        );
      })}
      {pluginSync.error || connectorSync.error ? (
        <AsyncError
          error={pluginSync.error ?? connectorSync.error}
          onRetry={() => {
            void pluginSync.revalidate();
            void connectorSync.mutate();
          }}
        />
      ) : (
        pluginSync.isHydrated &&
        !pluginSync.isValidating &&
        !connectorSync.isLoading &&
        entries.length === 0 && <Text type="secondary">{t('mcp.noneInstalled')}</Text>
      )}
    </Flexbox>
  );
};
