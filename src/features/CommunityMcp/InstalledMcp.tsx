import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { catalogDetailQuery } from '@/features/MarketplaceCatalog/catalogDetailQuery';
import NavItem from '@/features/NavPanel/components/NavItem';
import {
  AccountsNeedReauth,
  countAccountsNeedingReauth,
} from '@/features/Settings/skill/features/ConnectorRowFeedback';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { installedMcpSelection } from './installedMcpSelection';
import { isLegacyMcp } from './isLegacyMcp';

export const InstalledMcp = ({ hideTitle = false }: { hideTitle?: boolean }) => {
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
      brokenAccounts: countAccountsNeedingReauth(item.links),
      avatar: item.metadata?.avatar as string | undefined,
      identifier: item.identifier,
      title: item.name,
      value: installedMcpSelection(item.identifier),
    })),
    ...plugins
      .filter((item) => !connectorIds.has(item.identifier))
      .map((item) => ({
        brokenAccounts: 0,
        avatar: item.avatar,
        identifier: item.identifier,
        title: item.title,
        value: installedMcpSelection(item.identifier, item.type),
      })),
  ];

  return (
    <Flexbox gap={2} padding={8}>
      {!hideTitle && (
        <Text as="h2" fontSize={12} type="secondary">
          {t('plugins.installed')}
        </Text>
      )}
      {entries.map(({ identifier, value, title, avatar, brokenAccounts }) => {
        return (
          <WorkspaceLink key={value} to={'/community/mcp?' + catalogDetailQuery(query, value)}>
            <NavItem
              active={query.get('open') === value}
              title={title || identifier}
              description={
                brokenAccounts > 0 ? <AccountsNeedReauth count={brokenAccounts} /> : undefined
              }
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
